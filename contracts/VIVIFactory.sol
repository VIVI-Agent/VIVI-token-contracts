// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./VIVIdotWIN.sol";
import "./VIVIDistro.sol";

/**
 * @dev Interface for the Wrapped Ether (WETH) contract
 * Allows converting ETH to WETH and managing WETH tokens
 */
interface IWETH {
    /**
     * @dev Deposit ETH to receive WETH tokens
     * @notice Payable function that converts sent ETH to WETH
     */
    function deposit() external payable;

    /**
     * @dev Approve a spender to transfer WETH
     * @param spender Address authorized to spend tokens
     * @param amount Amount of tokens to approve
     * @return bool Success status
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @dev Transfer WETH tokens
     * @param to Recipient address
     * @param amount Amount to transfer
     * @return bool Success status
     */
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @dev Interface for Uniswap V3 Factory
 * Used to create new liquidity pools
 */
interface IUniswapV3Factory {
    /**
     * @dev Create a new pool for a token pair
     * @param tokenA First token address
     * @param tokenB Second token address
     * @param fee Fee tier for the pool (e.g., 10000 for 1%)
     * @return pool Address of the created pool
     */
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool);
}

/**
 * @dev Interface for Uniswap V3 Pool
 * Used to initialize pool price
 */
interface IUniswapV3Pool {
    /**
     * @dev Initialize the pool with a starting price
     * @param sqrtPriceX96 Initial price represented as sqrt(price) * 2^96
     */
    function initialize(uint160 sqrtPriceX96) external;
}

/**
 * @dev Interface for Uniswap V3 Position Manager
 * Handles liquidity position NFTs
 */
interface INonfungiblePositionManager {
    /**
     * @dev Parameters for minting a new position
     */
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    /**
     * @dev Mint a new liquidity position
     * @param params Minting parameters
     * @return tokenId ID of the minted position NFT
     * @return liquidity Amount of liquidity created
     * @return amount0 Actual amount of token0 used
     * @return amount1 Actual amount of token1 used
     */
    function mint(
        MintParams calldata params
    )
        external
        payable
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        );
}

/**
 * @dev Interface for Uniswap V3 Swap Router
 * Handles token swaps
 */
interface ISwapRouter {
    /**
     * @dev Parameters for a single exact input swap
     */
    struct ExactInputSingleParams {
        address tokenIn; // Token to swap from
        address tokenOut; // Token to swap to
        uint24 fee; // Pool fee tier
        address recipient; // Recipient of output tokens
        uint256 amountIn; // Exact amount of input tokens
        uint256 amountOutMinimum; // Minimum amount of output tokens
        uint160 sqrtPriceLimitX96; // Price limit (0 for no limit)
    }

    /**
     * @dev Execute a swap with exact input amount
     * @param params Swap parameters
     * @return amountOut Amount of output tokens received
     */
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

/**
 * @title VIVIFactory
 * @notice Factory contract for launching new tokens with Uniswap V3 liquidity
 * @dev Handles complete token launch process in a single transaction:
 */
contract VIVIFactory is Ownable, ReentrancyGuard {
    // ============ Constants ============

    /**
     * @dev Wrapped Ether address on Base network
     */
    address public constant WETH = 0x4200000000000000000000000000000000000006;

    /**
     * @dev Uniswap V3 Factory address on Base network
     */
    address constant UNISWAP_V3_FACTORY =
        0x33128a8fC17869897dcE68Ed026d694621f6FDfD;

    /**
     * @dev Uniswap V3 Position Manager address on Base network
     */
    address constant POSITION_MANAGER =
        0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;

    /**
     * @dev Uniswap V3 Swap Router address on Base network
     */
    address constant SWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

    /**
     * @dev Default fee tier for pools (10000 = 1%)
     */
    uint24 constant FEE_TIER = 10000;

    // ============ Structs ============

    /**
     * @dev Configuration for launching a new token
     */
    struct LaunchConfig {
        string tokenName; // Name of the token
        string tokenSymbol; // Symbol of the token
        uint256 totalSupply; // Total supply of tokens
        uint256 liquidityTokenAmount; // Tokens for initial liquidity
        uint256 liquidityEthAmount; // ETH for initial liquidity
        uint256 initialBuyEthAmount; // ETH for initial market buy
        address teamAddress; // Address receiving LP NFT
        // Distribution whitelist arrays
        address[] airdropAddresses; // Addresses for immediate airdrop
        uint256[] airdropAmounts; // Amounts for each airdrop
        address[] claimAddresses; // Addresses for claim system
        uint256[] claimAmounts; // Amounts for each claim
    }

    /**
     * @dev Result data from a token launch
     */
    struct LaunchResult {
        address token; // Deployed token address
        address distributor; // Deployed distributor address
        address pool; // Created pool address
        uint256 positionTokenId; // LP position NFT ID
        uint256 tokensBought; // Tokens bought in initial purchase
    }

    // ============ Events ============

    /**
     * @dev Emitted when a new token is successfully launched
     * @param token Address of the deployed token
     * @param distributor Address of the deployed distributor
     * @param pool Address of the created Uniswap pool
     * @param positionTokenId ID of the LP position NFT
     * @param initialPrice Initial price (sqrtPriceX96)
     */
    event TokenLaunched(
        address indexed token,
        address indexed distributor,
        address indexed pool,
        uint256 positionTokenId,
        uint256 initialPrice
    );

    // ============ Constructor ============

    /**
     * @dev Initialize the factory contract
     * @notice Sets the deployer as the initial owner
     */
    constructor() Ownable(msg.sender) {}

    // ============ Main Functions ============

    /**
     * @notice Launch a new token with automated liquidity provision
     * @dev Only callable by owner, handles complete launch process
     * @param config Launch configuration parameters
     * @return result Launch result containing deployed addresses
     *
     * Requirements:
     * - Caller must be owner
     * - Must send enough ETH for liquidity + initial buy
     * - All configuration arrays must match in length
     *
     * Process:
     * 1. Deploy VIVIDistro contract
     * 2. Deploy ERC20 token with initial distribution
     * 3. Create and initialize Uniswap V3 pool
     * 4. Add full-range liquidity position
     */
    function launchToken(
        LaunchConfig memory config
    )
        external
        payable
        nonReentrant
        onlyOwner
        returns (LaunchResult memory result)
    {
        // Validate ETH amount
        require(
            msg.value >= config.liquidityEthAmount + config.initialBuyEthAmount,
            "Insufficient ETH"
        );

        // 1. Deploy distributor contract
        VIVIDistro distributor = new VIVIDistro(address(this));
        result.distributor = address(distributor);

        // 2. Deploy token with custom distribution
        // Factory receives liquidity tokens, distributor receives the rest
        VIVIdotWIN token = new VIVIdotWIN(
            config.tokenName,
            config.tokenSymbol,
            config.totalSupply,
            address(this), // Factory receives tokens for liquidity
            config.liquidityTokenAmount,
            result.distributor // Distributor receives remaining tokens
        );
        result.token = address(token);

        // 3. Configure token in distributor
        distributor.setToken(result.token);

        // 4. Configure allocations (airdrops and claims)
        configureAllocations(
            distributor,
            config.airdropAddresses,
            config.airdropAmounts,
            config.claimAddresses,
            config.claimAmounts
        );

        // 5. Finalize allocations (lock the configuration)
        distributor.finalizeAllocations();

        // 6. Convert ETH to WETH
        IWETH(WETH).deposit{
            value: config.liquidityEthAmount + config.initialBuyEthAmount
        }();

        // 7. Create the Uniswap pool
        // Order tokens to ensure consistent pool address
        result.pool = IUniswapV3Factory(UNISWAP_V3_FACTORY).createPool(
            result.token < WETH ? result.token : WETH,
            result.token < WETH ? WETH : result.token,
            FEE_TIER
        );

        // 8. Initialize pool with calculated price
        uint160 sqrtPriceX96 = calculateSqrtPriceX96(
            config.liquidityTokenAmount,
            config.liquidityEthAmount,
            result.token < WETH
        );
        IUniswapV3Pool(result.pool).initialize(sqrtPriceX96);

        // 9. Approve tokens for position manager
        IERC20(result.token).approve(
            POSITION_MANAGER,
            config.liquidityTokenAmount
        );
        IWETH(WETH).approve(POSITION_MANAGER, config.liquidityEthAmount);

        // 10. Add liquidity to the pool
        // Determine token ordering for Uniswap
        (address token0, address token1) = result.token < WETH
            ? (result.token, WETH)
            : (WETH, result.token);

        (uint256 amount0, uint256 amount1) = token0 == result.token
            ? (config.liquidityTokenAmount, config.liquidityEthAmount)
            : (config.liquidityEthAmount, config.liquidityTokenAmount);

        // Create full-range position
        INonfungiblePositionManager.MintParams
            memory mintParams = INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: FEE_TIER,
                tickLower: -887200, // Full range lower bound
                tickUpper: 887200, // Full range upper bound
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0, // Accept any amount
                amount1Min: 0, // Accept any amount
                recipient: config.teamAddress,
                deadline: block.timestamp
            });

        (result.positionTokenId, , , ) = INonfungiblePositionManager(
            POSITION_MANAGER
        ).mint(mintParams);

        // 11. Execute initial buy order
        if (config.initialBuyEthAmount > 0) {
            IWETH(WETH).approve(SWAP_ROUTER, config.initialBuyEthAmount);

            ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter
                .ExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: result.token,
                    fee: FEE_TIER,
                    recipient: config.teamAddress,
                    amountIn: config.initialBuyEthAmount,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                });

            result.tokensBought = ISwapRouter(SWAP_ROUTER).exactInputSingle(
                swapParams
            );
        }

        // 12. Transfer any residual balances to sender
        // This ensures the factory never holds funds

        // Transfer residual tokens
        uint256 tokenBalance = IERC20(result.token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(result.token).transfer(msg.sender, tokenBalance);
        }

        // Transfer residual WETH
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));
        if (wethBalance > 0) {
            IWETH(WETH).transfer(msg.sender, wethBalance);
        }

        // Transfer residual native ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool success, ) = msg.sender.call{value: ethBalance}("");
            require(success, "ETH transfer failed");
        }

        // 13. Transfer distributor ownership to sender
        distributor.transferOwnership(msg.sender);

        emit TokenLaunched(
            result.token,
            result.distributor,
            result.pool,
            result.positionTokenId,
            sqrtPriceX96
        );

        return result;
    }

    // ============ Internal Functions ============

    /**
     * @dev Configure token allocations in the distributor
     * @param distributor Distributor contract instance
     * @param airdropAddresses Addresses to receive immediate airdrops
     * @param airdropAmounts Amounts for each airdrop address
     * @param claimAddresses Addresses eligible for claims
     * @param claimAmounts Amounts for each claim address
     *
     * @notice Combines airdrop and claim configurations into single arrays
     *         with appropriate distribution types
     */
    function configureAllocations(
        VIVIDistro distributor,
        address[] memory airdropAddresses,
        uint256[] memory airdropAmounts,
        address[] memory claimAddresses,
        uint256[] memory claimAmounts
    ) internal {
        // Prepare combined arrays for all allocations
        uint256 totalAddresses = airdropAddresses.length +
            claimAddresses.length;
        address[] memory allAddresses = new address[](totalAddresses);
        uint256[] memory allAmounts = new uint256[](totalAddresses);
        VIVIDistro.DistributionType[]
            memory allTypes = new VIVIDistro.DistributionType[](totalAddresses);

        // Add airdrop addresses (type AIRDROP)
        for (uint256 i = 0; i < airdropAddresses.length; i++) {
            allAddresses[i] = airdropAddresses[i];
            allAmounts[i] = airdropAmounts[i];
            allTypes[i] = VIVIDistro.DistributionType.AIRDROP;
        }

        // Add claim addresses (type CLAIM)
        uint256 offset = airdropAddresses.length;
        for (uint256 i = 0; i < claimAddresses.length; i++) {
            allAddresses[offset + i] = claimAddresses[i];
            allAmounts[offset + i] = claimAmounts[i];
            allTypes[offset + i] = VIVIDistro.DistributionType.CLAIM;
        }

        // Set all allocations in distributor
        distributor.setAllocations(allAddresses, allAmounts, allTypes);
    }

    // ============ Emergency Functions ============

    /**
     * @notice Emergency function to recover trapped funds
     * @dev Only callable by owner
     * @param token Token address (use address(0) for ETH)
     *
     * Requirements:
     * - Caller must be owner
     * - Contract must have balance > 0
     *
     * Use cases:
     * - Recover accidentally sent tokens
     * - Recover stuck ETH
     */
    function emergencyWithdraw(address token) external onlyOwner {
        if (token == address(0)) {
            // Withdraw ETH
            uint256 balance = address(this).balance;
            require(balance > 0, "No ETH to withdraw");
            (bool success, ) = owner().call{value: balance}("");
            require(success, "ETH transfer failed");
        } else {
            // Withdraw ERC20 tokens
            uint256 balance = IERC20(token).balanceOf(address(this));
            require(balance > 0, "No tokens to withdraw");
            IERC20(token).transfer(owner(), balance);
        }
    }

    /**
     * @notice Withdraw all ETH from contract
     * @dev Only callable by owner
     *
     * Requirements:
     * - Caller must be owner
     * - Contract must have ETH balance > 0
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    // ============ Helper Functions ============

    /**
     * @dev Calculate initial price for Uniswap V3 pool
     * @param tokenAmount Amount of tokens for liquidity
     * @param ethAmount Amount of ETH for liquidity
     * @param tokenIsToken0 Whether token address < WETH address
     * @return sqrtPriceX96 Square root price in Q64.96 format
     *
     * Formula:
     * - If token is token0: price = WETH/token = ethAmount/tokenAmount
     * - If WETH is token0: price = token/WETH = tokenAmount/ethAmount
     * - Result: sqrt(price) * 2^96
     */
    function calculateSqrtPriceX96(
        uint256 tokenAmount,
        uint256 ethAmount,
        bool tokenIsToken0
    ) internal pure returns (uint160) {
        // Uniswap V3 formula: price = amount1 / amount0

        if (tokenIsToken0) {
            // Token < WETH: token0 = token, token1 = WETH
            // price = WETH / token = ethAmount / tokenAmount
            // Convert to common decimal base (1e18)
            uint256 price = (ethAmount * 1e18) / tokenAmount;
            uint256 sqrtPrice = sqrt(price * 1e18); // Higher precision sqrt
            return uint160((sqrtPrice * (2 ** 96)) / 1e18);
        } else {
            // WETH < token: token0 = WETH, token1 = token
            // price = token / WETH = tokenAmount / ethAmount
            uint256 price = (tokenAmount * 1e18) / ethAmount;
            uint256 sqrtPrice = sqrt(price * 1e18);
            return uint160((sqrtPrice * (2 ** 96)) / 1e18);
        }
    }

    /**
     * @dev Calculate square root using Babylonian method
     * @param x Input value
     * @return Square root of x
     *
     * Algorithm:
     * 1. Start with initial guess z = (x + 1) / 2
     * 2. Iterate: z = (x/z + z) / 2
     * 3. Stop when z converges
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ Receive Function ============

    /**
     * @dev Enable contract to receive ETH
     * @notice Required for emergency withdrawals and ETH handling
     */
    receive() external payable {}
}
