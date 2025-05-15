// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenDistributor
 * @dev Contrato que maneja la distribución de tokens mediante whitelist, claim y airdrop
 */
contract TokenDistributor is Ownable(msg.sender), ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Token a distribuir
    IERC20 public token;

    // Mapping de asignaciones y claims
    mapping(address => uint256) public allocations;
    mapping(address => bool) public hasClaimed;

    // Array para tracking de direcciones
    address[] public allocationAddresses;
    mapping(address => bool) private isInArray;

    // Tipos de distribución
    enum DistributionType {
        CLAIM,
        AIRDROP
    }
    mapping(address => DistributionType) public distributionType;

    // Estadísticas
    uint256 public totalAllocated;
    uint256 public totalDistributed;
    uint256 public totalClaimed;
    uint256 public totalAirdropped;

    // Estados del contrato
    bool public allocationsFinalized = false;
    bool public claimingEnabled = false;
    bool public tokenSet = false;

    // Eventos
    event TokenSet(address indexed tokenAddress);
    event AllocationSet(
        address indexed user,
        uint256 amount,
        DistributionType distType
    );
    event TokensClaimed(address indexed user, uint256 amount);
    event TokensAirdropped(address indexed user, uint256 amount);
    event ClaimingEnabled();
    event ClaimingDisabled();
    event AirdropAllCompleted(
        uint256 addressesProcessed,
        uint256 tokensDistributed
    );
    event TokensRecovered(address indexed token, uint256 amount);

    // Modificadores
    modifier onlyFactory() {
        require(
            tokenSet == false || msg.sender == owner(),
            "Only factory or owner"
        );
        _;
    }

    // Constantes
    uint256 public constant MAX_BATCH_SIZE = 200;

    /**
     * @dev Constructor
     * @param owner_ Dirección del owner (usualmente el factory)
     */
    constructor(address owner_) {
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    /**
     * @dev Establecer el token a distribuir (solo puede llamarse una vez por el factory)
     * @param tokenAddress Dirección del token ERC20
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
     * @dev Configurar asignaciones para whitelist
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

            // Añadir al array si es nuevo
            if (!isInArray[user] && amount > 0) {
                allocationAddresses.push(user);
                isInArray[user] = true;
            }

            // Actualizar allocation
            totalAllocated = totalAllocated - allocations[user] + amount;
            allocations[user] = amount;
            distributionType[user] = distTypes[i];

            emit AllocationSet(user, amount, distTypes[i]);
        }
    }

    /**
     * @dev Finalizar asignaciones
     */
    function finalizeAllocations() external onlyOwner {
        require(tokenSet, "Token not set");
        require(!allocationsFinalized, "Already finalized");
        uint256 balance = token.balanceOf(address(this));
        require(totalAllocated <= balance, "Insufficient balance");
        allocationsFinalized = true;
    }

    /**
     * @dev Habilitar claiming
     */
    function enableClaiming() external onlyOwner {
        require(allocationsFinalized, "Not finalized");
        require(!claimingEnabled, "Already enabled");
        claimingEnabled = true;
        emit ClaimingEnabled();
    }

    /**
     * @dev Deshabilitar claiming
     */
    function disableClaiming() external onlyOwner {
        require(claimingEnabled, "Already disabled");
        claimingEnabled = false;
        emit ClaimingDisabled();
    }

    /**
     * @dev Claim tokens
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

    /**
     * @dev Owner puede ejecutar claim para un usuario específico
     * @param user Dirección del usuario para el cual ejecutar el claim
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
     * @dev Ejecutar airdrop inmediato (llamado por el factory)
     */
    function executeInitialAirdrop(
        address[] calldata recipients
    ) external onlyFactory nonReentrant {
        require(recipients.length <= MAX_BATCH_SIZE, "Batch too large");

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];

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
     * @dev airdrop all pending
     */
    function airdropAll(uint256 batchSize) external onlyOwner nonReentrant {
        require(allocationsFinalized, "Not finalized");
        require(batchSize > 0 && batchSize <= MAX_BATCH_SIZE, "Invalid batch");

        // Deshabilitar claiming
        if (claimingEnabled) {
            claimingEnabled = false;
            emit ClaimingDisabled();
        }

        uint256 processed = 0;
        uint256 distributed = 0;

        for (
            uint256 i = 0;
            i < allocationAddresses.length && processed < batchSize;
            i++
        ) {
            address user = allocationAddresses[i];

            if (allocations[user] > 0 && !hasClaimed[user]) {
                uint256 amount = allocations[user];
                hasClaimed[user] = true;

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

    /**
     * @dev Recuperar tokens no asignados
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
     * @dev Recuperar tokens enviados por error
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

    /**
     * @dev Obtener estadísticas
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
     * @dev Contar direcciones pendientes
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
     * @dev Obtener info de usuario
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
