// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./PlainERC20Factory.sol";
import "./TokenDistributor.sol";

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Factory {
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
}

interface INonfungiblePositionManager {
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

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

/**
 * @title TokenLaunchFactory
 * @dev Factory que maneja todo el proceso de lanzamiento en una sola transacción
 */
contract TokenLaunchFactory is Ownable, ReentrancyGuard {
    // Direcciones de Uniswap V3 en Base
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address constant UNISWAP_V3_FACTORY =
        0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant POSITION_MANAGER =
        0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address constant SWAP_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    uint24 constant FEE_TIER = 10000; // 1%

    struct LaunchConfig {
        string tokenName;
        string tokenSymbol;
        uint256 totalSupply;
        uint256 liquidityTokenAmount;
        uint256 liquidityEthAmount;
        uint256 initialBuyEthAmount;
        address teamAddress;
        // Whitelist para el distribuidor
        address[] airdropAddresses;
        uint256[] airdropAmounts;
        address[] claimAddresses;
        uint256[] claimAmounts;
    }

    struct LaunchResult {
        address token;
        address distributor;
        address pool;
        uint256 positionTokenId;
        uint256 tokensBought;
    }

    event TokenLaunched(
        address indexed token,
        address indexed distributor,
        address indexed pool,
        uint256 positionTokenId,
        uint256 initialPrice
    );

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Lanza token con distribución personalizada
     */
    function launchToken(
        LaunchConfig memory config
    ) external payable nonReentrant returns (LaunchResult memory result) {
        require(
            msg.value >= config.liquidityEthAmount + config.initialBuyEthAmount,
            "Insufficient ETH"
        );

        // 1. Deploy del distribuidor
        TokenDistributor distributor = new TokenDistributor(address(this));
        result.distributor = address(distributor);

        // 2. Deploy del token con distribución personalizada
        PlainERC20Factory token = new PlainERC20Factory(
            config.tokenName,
            config.tokenSymbol,
            config.totalSupply,
            address(this), // El factory recibe los tokens para liquidez
            config.liquidityTokenAmount,
            result.distributor // El distribuidor recibe el resto
        );
        result.token = address(token);

        // 3. Configurar token en el distribuidor
        distributor.setToken(result.token);

        // 4. Configurar allocations (airdrop y claim)
        configureAllocations(
            distributor,
            config.airdropAddresses,
            config.airdropAmounts,
            config.claimAddresses,
            config.claimAmounts
        );

        // 5. Finalizar allocations
        distributor.finalizeAllocations();

        // 6. Wrap ETH
        IWETH(WETH).deposit{
            value: config.liquidityEthAmount + config.initialBuyEthAmount
        }();

        // 7. Crear el pool
        result.pool = IUniswapV3Factory(UNISWAP_V3_FACTORY).createPool(
            result.token < WETH ? result.token : WETH,
            result.token < WETH ? WETH : result.token,
            FEE_TIER
        );

        // 8. Inicializar el pool con precio
        uint160 sqrtPriceX96 = calculateSqrtPriceX96(
            config.liquidityTokenAmount,
            config.liquidityEthAmount,
            result.token < WETH
        );
        IUniswapV3Pool(result.pool).initialize(sqrtPriceX96);

        // 9. Aprobar tokens para position manager
        IERC20(result.token).approve(
            POSITION_MANAGER,
            config.liquidityTokenAmount
        );
        IWETH(WETH).approve(POSITION_MANAGER, config.liquidityEthAmount);

        // 10. Añadir liquidez
        (address token0, address token1) = result.token < WETH
            ? (result.token, WETH)
            : (WETH, result.token);

        (uint256 amount0, uint256 amount1) = token0 == result.token
            ? (config.liquidityTokenAmount, config.liquidityEthAmount)
            : (config.liquidityEthAmount, config.liquidityTokenAmount);

        INonfungiblePositionManager.MintParams
            memory mintParams = INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: FEE_TIER,
                tickLower: -887200, // Full range
                tickUpper: 887200, // Full range
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: config.teamAddress,
                deadline: block.timestamp
            });

        (result.positionTokenId, , , ) = INonfungiblePositionManager(
            POSITION_MANAGER
        ).mint(mintParams);

        // 11. Hacer primera compra
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

        // 12. Ejecutar airdrops inmediatos
        if (config.airdropAddresses.length > 0) {
            distributor.executeInitialAirdrop(config.airdropAddresses);
        }

        // 14. Transferir ownership del distribuidor
        distributor.transferOwnership(config.teamAddress);

        emit TokenLaunched(
            result.token,
            result.distributor,
            result.pool,
            result.positionTokenId,
            sqrtPriceX96
        );

        return result;
    }

    /**
     * @dev Configura las allocations en el distribuidor
     */
    function configureAllocations(
        TokenDistributor distributor,
        address[] memory airdropAddresses,
        uint256[] memory airdropAmounts,
        address[] memory claimAddresses,
        uint256[] memory claimAmounts
    ) internal {
        // Preparar arrays combinados
        uint256 totalAddresses = airdropAddresses.length +
            claimAddresses.length;
        address[] memory allAddresses = new address[](totalAddresses);
        uint256[] memory allAmounts = new uint256[](totalAddresses);
        TokenDistributor.DistributionType[]
            memory allTypes = new TokenDistributor.DistributionType[](
                totalAddresses
            );

        // Añadir airdrop addresses (tipo AIRDROP)
        for (uint256 i = 0; i < airdropAddresses.length; i++) {
            allAddresses[i] = airdropAddresses[i];
            allAmounts[i] = airdropAmounts[i];
            allTypes[i] = TokenDistributor.DistributionType.AIRDROP;
        }

        // Añadir claim addresses (tipo CLAIM)
        uint256 offset = airdropAddresses.length;
        for (uint256 i = 0; i < claimAddresses.length; i++) {
            allAddresses[offset + i] = claimAddresses[i];
            allAmounts[offset + i] = claimAmounts[i];
            allTypes[offset + i] = TokenDistributor.DistributionType.CLAIM;
        }

        // Configurar allocations
        distributor.setAllocations(allAddresses, allAmounts, allTypes);
    }

    /**
     * @dev Calcula sqrtPriceX96 basado en las cantidades
     */
    function calculateSqrtPriceX96(
        uint256 tokenAmount,
        uint256 ethAmount,
        bool tokenIsToken0
    ) internal pure returns (uint160) {
        // La fórmula de Uniswap V3: price = amount1 / amount0

        if (tokenIsToken0) {
            // Si token < WETH: token0 = token, token1 = WETH
            // price = WETH / token = ethAmount / tokenAmount
            // Necesitamos convertir a base decimal común (1e18)
            uint256 price = (ethAmount * 1e18) / tokenAmount;
            uint256 sqrtPrice = sqrt(price * 1e18); // sqrt con más precisión
            return uint160((sqrtPrice * (2 ** 96)) / 1e18);
        } else {
            // Si WETH < token: token0 = WETH, token1 = token
            // price = token / WETH = tokenAmount / ethAmount
            uint256 price = (tokenAmount * 1e18) / ethAmount;
            uint256 sqrtPrice = sqrt(price * 1e18);
            return uint160((sqrtPrice * (2 ** 96)) / 1e18);
        }
    }

    /**
     * @dev Calcula raíz cuadrada
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
}
