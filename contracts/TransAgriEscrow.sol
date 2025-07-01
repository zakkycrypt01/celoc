// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TransAgri Escrow Contract
 * @dev Escrow system for crop transactions between farmers and buyers
 * Supports cUSD payments on Celo network
 */
contract TransAgriEscrow is ReentrancyGuard, Ownable, Pausable {
    // cUSD token address on Celo Mainnet: 0x765DE816845861e75A25fCA122bb6898B8B1282a
    // cUSD token address on Celo Alfajores: 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1
    IERC20 public immutable cUSD;
    
    // Platform fee (in basis points, e.g., 250 = 2.5%)
    uint256 public platformFee = 250;
    uint256 public constant MAX_FEE = 1000; // 10% max fee
    
    // Dispute resolution timeouts
    uint256 public constant DELIVERY_TIMEOUT = 14 days;
    uint256 public constant DISPUTE_TIMEOUT = 7 days;
    
    enum OrderStatus {
        Created,
        Funded,
        Shipped,
        Delivered,
        Disputed,
        Completed,
        Cancelled,
        Refunded
    }
    
    struct EscrowOrder {
        uint256 orderId;
        string cropListingId; // Reference to off-chain crop listing
        address buyer;
        address farmer;
        uint256 amount; // Amount in cUSD (18 decimals)
        uint256 platformFeeAmount;
        OrderStatus status;
        uint256 createdAt;
        uint256 deliveryDeadline;
        uint256 disputeTimeout;
        string deliveryDetails; // IPFS hash or simple string
        bool buyerConfirmed;
        bool farmerShipped;
    }
    
    mapping(uint256 => EscrowOrder) public orders;
    mapping(address => uint256[]) public userOrders; // Track orders per user
    
    uint256 private orderCounter;
    uint256 public totalPlatformFees;
    
    // Events
    event OrderCreated(
        uint256 indexed orderId,
        string indexed cropListingId,
        address indexed buyer,
        address farmer,
        uint256 amount
    );
    
    event OrderFunded(uint256 indexed orderId, uint256 amount);
    event OrderShipped(uint256 indexed orderId, string deliveryDetails);
    event OrderDelivered(uint256 indexed orderId);
    event OrderCompleted(uint256 indexed orderId, uint256 farmerAmount, uint256 platformFee);
    event OrderDisputed(uint256 indexed orderId, address disputeInitiator);
    event OrderCancelled(uint256 indexed orderId);
    event OrderRefunded(uint256 indexed orderId, uint256 refundAmount);
    event DisputeResolved(uint256 indexed orderId, address winner);
    
    constructor(address _cUSDAddress) Ownable(msg.sender) Pausable() ReentrancyGuard() {
        cUSD = IERC20(_cUSDAddress);
    }
    
    /**
     * @dev Create a new escrow order
     * @param _cropListingId Reference to the crop listing
     * @param _farmer Address of the farmer/seller
     * @param _amount Amount in cUSD (with 18 decimals)
     */
    function createOrder(
        string memory _cropListingId,
        address _farmer,
        uint256 _amount
    ) external whenNotPaused returns (uint256) {
        require(_farmer != address(0), "Invalid farmer address");
        require(_farmer != msg.sender, "Buyer cannot be farmer");
        require(_amount > 0, "Amount must be greater than 0");
        require(bytes(_cropListingId).length > 0, "Crop listing ID required");
        
        orderCounter++;
        uint256 orderId = orderCounter;
        
        uint256 feeAmount = (_amount * platformFee) / 10000;
        
        orders[orderId] = EscrowOrder({
            orderId: orderId,
            cropListingId: _cropListingId,
            buyer: msg.sender,
            farmer: _farmer,
            amount: _amount,
            platformFeeAmount: feeAmount,
            status: OrderStatus.Created,
            createdAt: block.timestamp,
            deliveryDeadline: 0,
            disputeTimeout: 0,
            deliveryDetails: "",
            buyerConfirmed: false,
            farmerShipped: false
        });
        
        userOrders[msg.sender].push(orderId);
        userOrders[_farmer].push(orderId);
        
        emit OrderCreated(orderId, _cropListingId, msg.sender, _farmer, _amount);
        
        return orderId;
    }
    
    /**
     * @dev Fund an escrow order (buyer deposits cUSD)
     * @param _orderId The order ID to fund
     */
    function fundOrder(uint256 _orderId) external nonReentrant whenNotPaused {
        EscrowOrder storage order = orders[_orderId];
        require(order.buyer == msg.sender, "Only buyer can fund order");
        require(order.status == OrderStatus.Created, "Order already funded or invalid");
        
        uint256 totalAmount = order.amount + order.platformFeeAmount;
        require(cUSD.transferFrom(msg.sender, address(this), totalAmount), "Transfer failed");
        
        order.status = OrderStatus.Funded;
        order.deliveryDeadline = block.timestamp + DELIVERY_TIMEOUT;
        
        emit OrderFunded(_orderId, totalAmount);
    }
    
    /**
     * @dev Farmer marks order as shipped
     * @param _orderId The order ID
     * @param _deliveryDetails Delivery tracking info or IPFS hash
     */
    function markShipped(uint256 _orderId, string memory _deliveryDetails) external whenNotPaused {
        EscrowOrder storage order = orders[_orderId];
        require(order.farmer == msg.sender, "Only farmer can mark as shipped");
        require(order.status == OrderStatus.Funded, "Order not funded");
        
        order.status = OrderStatus.Shipped;
        order.farmerShipped = true;
        order.deliveryDetails = _deliveryDetails;
        
        emit OrderShipped(_orderId, _deliveryDetails);
    }
    
    /**
     * @dev Buyer confirms delivery and releases funds
     * @param _orderId The order ID
     */
    function confirmDelivery(uint256 _orderId) external nonReentrant whenNotPaused {
        EscrowOrder storage order = orders[_orderId];
        require(order.buyer == msg.sender, "Only buyer can confirm delivery");
        require(order.status == OrderStatus.Shipped, "Order not shipped");
        
        order.status = OrderStatus.Delivered;
        order.buyerConfirmed = true;
        
        _completeOrder(_orderId);
        
        emit OrderDelivered(_orderId);
    }
    
    /**
     * @dev Auto-release funds if delivery deadline passed and no dispute
     * @param _orderId The order ID
     */
    function autoReleaseOrder(uint256 _orderId) external nonReentrant whenNotPaused {
        EscrowOrder storage order = orders[_orderId];
        require(order.status == OrderStatus.Shipped, "Order not shipped");
        require(block.timestamp > order.deliveryDeadline, "Delivery deadline not reached");
        require(order.status != OrderStatus.Disputed, "Order is disputed");
        
        order.status = OrderStatus.Delivered;
        _completeOrder(_orderId);
    }
    
    /**
     * @dev Initiate a dispute
     * @param _orderId The order ID
     */
    function initiateDispute(uint256 _orderId) external whenNotPaused {
        EscrowOrder storage order = orders[_orderId];
        require(
            order.buyer == msg.sender || order.farmer == msg.sender,
            "Only buyer or farmer can dispute"
        );
        require(
            order.status == OrderStatus.Funded || order.status == OrderStatus.Shipped,
            "Invalid order status for dispute"
        );
        
        order.status = OrderStatus.Disputed;
        order.disputeTimeout = block.timestamp + DISPUTE_TIMEOUT;
        
        emit OrderDisputed(_orderId, msg.sender);
    }
    
    /**
     * @dev Resolve dispute (admin only)
     * @param _orderId The order ID
     * @param _favorBuyer True to refund buyer, false to pay farmer
     */
    function resolveDispute(uint256 _orderId, bool _favorBuyer) external onlyOwner nonReentrant {
        EscrowOrder storage order = orders[_orderId];
        require(order.status == OrderStatus.Disputed, "Order not disputed");
        
        if (_favorBuyer) {
            // Refund to buyer
            uint256 refundAmount = order.amount + order.platformFeeAmount;
            require(cUSD.transfer(order.buyer, refundAmount), "Refund failed");
            order.status = OrderStatus.Refunded;
            emit OrderRefunded(_orderId, refundAmount);
        } else {
            // Pay farmer
            order.status = OrderStatus.Delivered;
            _completeOrder(_orderId);
        }
        
        emit DisputeResolved(_orderId, _favorBuyer ? order.buyer : order.farmer);
    }
    
    /**
     * @dev Cancel unfunded order
     * @param _orderId The order ID
     */
    function cancelOrder(uint256 _orderId) external whenNotPaused {
        EscrowOrder storage order = orders[_orderId];
        require(
            order.buyer == msg.sender || order.farmer == msg.sender,
            "Only buyer or farmer can cancel"
        );
        require(order.status == OrderStatus.Created, "Can only cancel unfunded orders");
        
        order.status = OrderStatus.Cancelled;
        emit OrderCancelled(_orderId);
    }
    
    /**
     * @dev Internal function to complete order and release funds
     * @param _orderId The order ID
     */
    function _completeOrder(uint256 _orderId) internal {
        EscrowOrder storage order = orders[_orderId];
        
        // Transfer funds to farmer
        require(cUSD.transfer(order.farmer, order.amount), "Payment to farmer failed");
        
        // Add platform fee to total
        totalPlatformFees += order.platformFeeAmount;
        
        order.status = OrderStatus.Completed;
        
        emit OrderCompleted(_orderId, order.amount, order.platformFeeAmount);
    }
    
    /**
     * @dev Withdraw platform fees (admin only)
     * @param _amount Amount to withdraw
     */
    function withdrawPlatformFees(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount <= totalPlatformFees, "Insufficient platform fees");
        require(cUSD.transfer(owner(), _amount), "Withdrawal failed");
        totalPlatformFees -= _amount;
    }
    
    /**
     * @dev Update platform fee (admin only)
     * @param _newFee New fee in basis points
     */
    function updatePlatformFee(uint256 _newFee) external onlyOwner {
        require(_newFee <= MAX_FEE, "Fee too high");
        platformFee = _newFee;
    }
    
    /**
     * @dev Emergency pause (admin only)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause (admin only)
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // View functions
    function getOrder(uint256 _orderId) external view returns (EscrowOrder memory) {
        return orders[_orderId];
    }
    
    function getUserOrders(address _user) external view returns (uint256[] memory) {
        return userOrders[_user];
    }
    
    function getOrderCount() external view returns (uint256) {
        return orderCounter;
    }
    
    function isOrderExpired(uint256 _orderId) external view returns (bool) {
        EscrowOrder memory order = orders[_orderId];
        return order.deliveryDeadline > 0 && block.timestamp > order.deliveryDeadline;
    }
    
    function getContractBalance() external view returns (uint256) {
        return cUSD.balanceOf(address(this));
    }
}