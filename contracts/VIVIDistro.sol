// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VIVIDistro
 * @notice Manages token distribution through whitelist, claims, and airdrops
 * @dev This contract handles multiple distribution mechanisms:
 *      - Immediate airdrops for specific addresses (team, treasury)
 *      - Claim system for vested or time-locked distributions
 *      - Batch processing to optimize gas costs
 *      - Recovery functions for unallocated tokens
 *
 */
contract VIVIDistro is Ownable(msg.sender), ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /**
     * @dev Token being distributed
     */
    IERC20 public token;

    /**
     * @dev User allocations mapping
     * Maps user address to allocated token amount
     */
    mapping(address => uint256) public allocations;

    /**
     * @dev Tracks whether user has claimed/received tokens
     */
    mapping(address => bool) public hasClaimed;

    /**
     * @dev Array of all addresses with allocations
     * Used for batch processing and enumeration
     */
    address[] public allocationAddresses;

    /**
     * @dev Helper mapping to check if address is in array
     * Prevents duplicate entries
     */
    mapping(address => bool) private isInArray;

    /**
     * @dev Distribution types for each user
     */
    enum DistributionType {
        CLAIM, // User must claim tokens
        AIRDROP // Tokens sent automatically
    }
    mapping(address => DistributionType) public distributionType;

    // ============ Statistics ============

    /**
     * @dev Total tokens allocated to users
     */
    uint256 public totalAllocated;

    /**
     * @dev Total tokens distributed (claimed + airdropped)
     */
    uint256 public totalDistributed;

    /**
     * @dev Total tokens distributed via claims
     */
    uint256 public totalClaimed;

    /**
     * @dev Total tokens distributed via airdrops
     */
    uint256 public totalAirdropped;

    // ============ Contract States ============

    /**
     * @dev Whether allocations have been finalized
     * Once true, no more allocations can be added/modified
     */
    bool public allocationsFinalized = false;

    /**
     * @dev Whether claiming is currently enabled
     */
    bool public claimingEnabled = false;

    /**
     * @dev Whether the token has been set
     * Can only be set once by factory
     */
    bool public tokenSet = false;

    // ============ Events ============

    /**
     * @dev Emitted when token is set
     * @param tokenAddress Address of the distribution token
     */
    event TokenSet(address indexed tokenAddress);

    /**
     * @dev Emitted when allocation is set for a user
     * @param user User address
     * @param amount Token amount allocated
     * @param distType Distribution type (claim/airdrop)
     */
    event AllocationSet(
        address indexed user,
        uint256 amount,
        DistributionType distType
    );

    /**
     * @dev Emitted when user claims tokens
     * @param user User address
     * @param amount Amount claimed
     */
    event TokensClaimed(address indexed user, uint256 amount);

    /**
     * @dev Emitted when tokens are airdropped
     * @param user Recipient address
     * @param amount Amount airdropped
     */
    event TokensAirdropped(address indexed user, uint256 amount);

    /**
     * @dev Emitted when claiming is enabled
     */
    event ClaimingEnabled();

    /**
     * @dev Emitted when claiming is disabled
     */
    event ClaimingDisabled();

    /**
     * @dev Emitted when batch airdrop completes
     * @param addressesProcessed Number of addresses processed
     * @param tokensDistributed Total tokens distributed
     */
    event AirdropAllCompleted(
        uint256 addressesProcessed,
        uint256 tokensDistributed
    );

    /**
     * @dev Emitted when tokens are recovered
     * @param token Token address
     * @param amount Amount recovered
     */
    event TokensRecovered(address indexed token, uint256 amount);

    // ============ Modifiers ============

    /**
     * @dev Restricts function to factory or owner
     * Used for initial setup functions
     */
    modifier onlyFactory() {
        require(
            tokenSet == false || msg.sender == owner(),
            "Only factory or owner"
        );
        _;
    }

    // ============ Constants ============

    /**
     * @dev Maximum batch size for operations
     * Prevents gas limit issues
     */
    uint256 public constant MAX_BATCH_SIZE = 200;

    // ============ Constructor ============

    /**
     * @dev Initialize distributor with owner
     * @param owner_ Initial owner address (typically the factory)
     * @notice If owner_ is zero address, deployer becomes owner
     */
    constructor(address owner_) {
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    // ============ Setup Functions ============

    /**
     * @notice Set the token to be distributed
     * @dev Can only be called once by factory or owner
     * @param tokenAddress ERC20 token address
     *
     * Requirements:
     * - Token not already set
     * - Valid token address
     * - Allocations not finalized
     *
     * @dev This is typically called by the factory immediately after deployment
     */
    function setToken(address tokenAddress) external onlyFactory {
        require(!tokenSet, "Token already set");
        require(tokenAddress != address(0), "Invalid token address");
        require(!allocationsFinalized, "Allocations finalized");

        token = IERC20(tokenAddress);
        tokenSet = true;
        emit TokenSet(tokenAddress);
    }

    /**
     * @notice Configure allocations for whitelist
     * @dev Batch operation to set multiple allocations
     * @param users Array of user addresses
     * @param amounts Array of token amounts
     * @param distTypes Array of distribution types
     */
    function setAllocations(
        address[] calldata users,
        uint256[] calldata amounts,
        DistributionType[] calldata distTypes
    ) external onlyOwner {
        require(tokenSet, "Token not set");
        require(!allocationsFinalized, "Allocations finalized");
        require(users.length == amounts.length, "Length mismatch");
        require(users.length == distTypes.length, "Type length mismatch");
        require(users.length <= MAX_BATCH_SIZE, "Batch too large");

        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            uint256 amount = amounts[i];

            // Add to tracking array if new address with non-zero allocation
            if (!isInArray[user] && amount > 0) {
                allocationAddresses.push(user);
                isInArray[user] = true;
            }

            // Update allocation and adjust total
            totalAllocated = totalAllocated - allocations[user] + amount;
            allocations[user] = amount;
            distributionType[user] = distTypes[i];

            emit AllocationSet(user, amount, distTypes[i]);
        }
    }

    /**
     * @notice Finalize allocations and prevent further changes
     * @dev Locks the allocation configuration
     *
     * Requirements:
     * - Token must be set
     * - Not already finalized
     * - Contract balance >= total allocated
     *
     * Effects:
     * - Sets allocationsFinalized to true
     * - Prevents further allocation changes
     */
    function finalizeAllocations() external onlyOwner {
        require(tokenSet, "Token not set");
        require(!allocationsFinalized, "Already finalized");
        uint256 balance = token.balanceOf(address(this));
        require(totalAllocated <= balance, "Insufficient balance");
        allocationsFinalized = true;
    }

    // ============ Distribution Control ============

    /**
     * @notice Enable claiming for eligible users
     * @dev Opens the claim window
     *
     * Requirements:
     * - Allocations must be finalized
     * - Claiming not already enabled
     */
    function enableClaiming() external onlyOwner {
        require(allocationsFinalized, "Not finalized");
        require(!claimingEnabled, "Already enabled");
        claimingEnabled = true;
        emit ClaimingEnabled();
    }

    /**
     * @notice Disable claiming
     * @dev Closes the claim window
     *
     * Requirements:
     * - Claiming must be enabled
     */
    function disableClaiming() external onlyOwner {
        require(claimingEnabled, "Already disabled");
        claimingEnabled = false;
        emit ClaimingDisabled();
    }

    // ============ User Functions ============

    /**
     * @notice Claim allocated tokens
     * @dev Users with CLAIM type allocation can claim their tokens
     *
     * Requirements:
     * - Claiming must be enabled
     * - User must have allocation
     * - User hasn't already claimed
     * - User must have CLAIM distribution type
     *
     * Effects:
     * - Marks user as claimed
     * - Updates statistics
     * - Transfers tokens to user
     */
    function claimTokens() external nonReentrant {
        require(claimingEnabled, "Claiming disabled");
        require(allocations[msg.sender] > 0, "No allocation");
        require(!hasClaimed[msg.sender], "Already claimed");
        require(
            distributionType[msg.sender] == DistributionType.CLAIM,
            "Not eligible"
        );

        uint256 amount = allocations[msg.sender];
        hasClaimed[msg.sender] = true;
        totalClaimed += amount;
        totalDistributed += amount;

        token.safeTransfer(msg.sender, amount);
        emit TokensClaimed(msg.sender, amount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Execute claim on behalf of a user
     * @dev Owner can trigger claims for specific users
     * @param user Address to claim for
     *
     * Requirements:
     * - Same as claimTokens but for specific user
     *
     * Use cases:
     * - Help users with gas issues
     * - Me at phone Me No meTamasque
     */
    function claimFor(address user) external onlyOwner nonReentrant {
        require(claimingEnabled, "Claiming disabled");
        require(allocations[user] > 0, "No allocation");
        require(!hasClaimed[user], "Already claimed");
        require(
            distributionType[user] == DistributionType.CLAIM,
            "Not eligible for claim"
        );

        uint256 amount = allocations[user];
        hasClaimed[user] = true;
        totalClaimed += amount;
        totalDistributed += amount;

        token.safeTransfer(user, amount);
        emit TokensClaimed(user, amount);
    }

    /**
     * @notice Execute initial airdrop batch
     * @dev Called by factory for immediate distribution
     * @param recipients Array of recipients
     *
     * Requirements:
     * - Caller must be factory or owner
     * - Batch size within limit
     *
     * Effects:
     * - Processes only AIRDROP type allocations
     * - Marks recipients as claimed
     * - Updates statistics
     */
    function executeInitialAirdrop(
        address[] calldata recipients
    ) external onlyFactory nonReentrant {
        require(recipients.length <= MAX_BATCH_SIZE, "Batch too large");

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];

            // Only process if: has allocation, not claimed, is airdrop type
            if (
                allocations[recipient] > 0 &&
                !hasClaimed[recipient] &&
                distributionType[recipient] == DistributionType.AIRDROP
            ) {
                uint256 amount = allocations[recipient];
                hasClaimed[recipient] = true;
                totalAirdropped += amount;
                totalDistributed += amount;

                token.safeTransfer(recipient, amount);
                emit TokensAirdropped(recipient, amount);
            }
        }
    }

    /**
     * @notice Airdrop to all pending recipients
     * @dev Batch process all unclaimed allocations
     * @param batchSize Maximum addresses to process
     *
     * Requirements:
     * - Allocations must be finalized
     * - Valid batch size
     *
     * Effects:
     * - Disables claiming if enabled
     * - Processes both CLAIM and AIRDROP types
     * - Updates all statistics
     *
     * @dev Useful for final distribution or emergency distribution
     */
    function airdropAll(uint256 batchSize) external onlyOwner nonReentrant {
        require(allocationsFinalized, "Not finalized");
        require(batchSize > 0 && batchSize <= MAX_BATCH_SIZE, "Invalid batch");

        // Automatically disable claiming when doing final airdrop
        if (claimingEnabled) {
            claimingEnabled = false;
            emit ClaimingDisabled();
        }

        uint256 processed = 0;
        uint256 distributed = 0;

        // Process addresses in batches
        for (
            uint256 i = 0;
            i < allocationAddresses.length && processed < batchSize;
            i++
        ) {
            address user = allocationAddresses[i];

            if (allocations[user] > 0 && !hasClaimed[user]) {
                uint256 amount = allocations[user];
                hasClaimed[user] = true;

                // Update appropriate counter based on type
                if (distributionType[user] == DistributionType.CLAIM) {
                    totalClaimed += amount;
                } else {
                    totalAirdropped += amount;
                }

                totalDistributed += amount;
                token.safeTransfer(user, amount);

                distributed += amount;
                processed++;

                emit TokensClaimed(user, amount);
            }
        }

        emit AirdropAllCompleted(processed, distributed);
    }

    // ============ Recovery Functions ============

    /**
     * @notice Recover unallocated tokens
     * @dev Sends excess tokens back to owner
     *
     * Requirements:
     * - Allocations must be finalized
     *
     * Calculation:
     * - Unallocated = Balance + Distributed - Allocated
     *
     * Use case:
     * - Recover tokens if over-funded
     * - Clean up after distribution
     */
    function recoverUnallocatedTokens() external onlyOwner {
        require(allocationsFinalized, "Not finalized");
        uint256 balance = token.balanceOf(address(this));
        uint256 unallocated = balance + totalDistributed - totalAllocated;

        if (unallocated > 0) {
            token.safeTransfer(owner(), unallocated);
            emit TokensRecovered(address(token), unallocated);
        }
    }

    /**
     * @notice Recover accidentally sent tokens
     * @dev Retrieves non-distribution tokens
     * @param tokenAddress Token to recover
     *
     * Requirements:
     * - Cannot recover distribution token
     *
     * Use case:
     * - User accidentally sends wrong token
     * - Recover stuck tokens
     */
    function recoverERC20(address tokenAddress) external onlyOwner {
        require(
            tokenAddress != address(token),
            "Cannot recover distribution token"
        );
        IERC20 otherToken = IERC20(tokenAddress);
        uint256 balance = otherToken.balanceOf(address(this));

        if (balance > 0) {
            otherToken.safeTransfer(owner(), balance);
            emit TokensRecovered(tokenAddress, balance);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get contract statistics
     * @dev Returns comprehensive distribution statistics
     * @return _totalAllocated Total tokens allocated
     * @return _totalDistributed Total tokens distributed
     * @return _totalClaimed Tokens distributed via claims
     * @return _totalAirdropped Tokens distributed via airdrops
     * @return _contractBalance Current token balance
     * @return _finalized Whether allocations are finalized
     * @return _claimingEnabled Whether claiming is enabled
     * @return _pendingCount Number of pending distributions
     */
    function getStats()
        external
        view
        returns (
            uint256 _totalAllocated,
            uint256 _totalDistributed,
            uint256 _totalClaimed,
            uint256 _totalAirdropped,
            uint256 _contractBalance,
            bool _finalized,
            bool _claimingEnabled,
            uint256 _pendingCount
        )
    {
        uint256 balance = tokenSet ? token.balanceOf(address(this)) : 0;
        return (
            totalAllocated,
            totalDistributed,
            totalClaimed,
            totalAirdropped,
            balance,
            allocationsFinalized,
            claimingEnabled,
            getPendingCount()
        );
    }

    /**
     * @notice Count pending distributions
     * @dev Iterates through addresses to count unclaimed
     * @return count Number of addresses with unclaimed tokens
     *
     * @notice Gas intensive for large address arrays
     */
    function getPendingCount() public view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < allocationAddresses.length; i++) {
            address user = allocationAddresses[i];
            if (allocations[user] > 0 && !hasClaimed[user]) {
                count++;
            }
        }
        return count;
    }

    /**
     * @notice Get user distribution information
     * @dev Returns user-specific allocation data
     * @param user User address to query
     * @return allocation Token amount allocated
     * @return claimed Whether user has claimed
     * @return distType Distribution type for user
     * @return canClaim Whether user can currently claim
     */
    function getUserInfo(
        address user
    )
        external
        view
        returns (
            uint256 allocation,
            bool claimed,
            DistributionType distType,
            bool canClaim
        )
    {
        // User can claim if: claiming enabled, has allocation, not claimed, type is CLAIM
        bool eligible = claimingEnabled &&
            allocations[user] > 0 &&
            !hasClaimed[user] &&
            distributionType[user] == DistributionType.CLAIM;

        return (
            allocations[user],
            hasClaimed[user],
            distributionType[user],
            eligible
        );
    }
}
