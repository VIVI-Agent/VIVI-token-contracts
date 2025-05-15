// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title VIVIdotWIN
 * @author [VIVI Kiddos]
 * @notice Standard ERC20 token with custom initial distribution
 * @dev This contract creates a standard ERC20 token and distributes the initial supply
 *      between two recipients: one for liquidity provision and one for general distribution.
 */
contract VIVIdotWIN is ERC20 {
    //
    //  __     _______     _____    _       _ __        _____ _   _
    //  \ \   / /_ _\ \   / /_ _|__| | ___ | |\ \      / /_ _| \ | |
    //   \ \ / / | | \ \ / / | |/ _` |/ _ \| __\ \ /\ / / | ||  \| |
    //    \ V /  | |  \ V /  | | (_| | (_) | |_ \ V  V /  | || |\  |
    //     \_/  |___|  \_/  |___\__,_|\___/ \__| \_/\_/  |___|_| \_|
    //
    /**
     * @notice Creates a new ERC20 token with split initial distribution
     * @dev Mints the total supply split between liquidity and distribution recipients
     * @param name_ The name of the token (e.g., "My Token")
     * @param symbol_ The symbol of the token (e.g., "MTK")
     * @param totalSupply_ The total supply of tokens to mint (in wei units)
     * @param liquidityRecipient_ Address that receives tokens for liquidity provision
     * @param liquidityAmount_ Amount of tokens allocated for liquidity (in wei units)
     * @param distributorRecipient_ Address that receives remaining tokens for distribution
     * @dev This constructor is typically called by VIVIFactory
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address liquidityRecipient_,
        uint256 liquidityAmount_,
        address distributorRecipient_
    ) ERC20(name_, symbol_) {
        // Validate addresses
        require(
            liquidityRecipient_ != address(0),
            "Invalid liquidity recipient"
        );
        require(distributorRecipient_ != address(0), "Invalid distributor");

        // Validate amounts
        require(liquidityAmount_ <= totalSupply_, "Liquidity exceeds supply");

        // Mint tokens for liquidity provision
        // This is typically the VIVIFactory address initially
        _mint(liquidityRecipient_, liquidityAmount_);

        // Calculate and mint remaining tokens to distributor
        // This is typically the VIVIDistro contract
        uint256 distributorAmount = totalSupply_ - liquidityAmount_;
        if (distributorAmount > 0) {
            _mint(distributorRecipient_, distributorAmount);
        }
    }
}
