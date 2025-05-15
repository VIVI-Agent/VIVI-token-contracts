// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title PlainERC20Factory
 * @dev Token ERC20 que distribuye el supply entre liquidez y distribución
 */
contract PlainERC20Factory is ERC20 {
    /**
     * @dev Constructor que mintea tokens a dos destinatarios
     * @param name_ Nombre del token
     * @param symbol_ Símbolo del token
     * @param totalSupply_ Supply total
     * @param liquidityRecipient_ Dirección que recibe tokens para liquidez
     * @param liquidityAmount_ Cantidad de tokens para liquidez
     * @param distributorRecipient_ Dirección del distribuidor (recibe el resto)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address liquidityRecipient_,
        uint256 liquidityAmount_,
        address distributorRecipient_
    ) ERC20(name_, symbol_) {
        require(
            liquidityRecipient_ != address(0),
            "Invalid liquidity recipient"
        );
        require(distributorRecipient_ != address(0), "Invalid distributor");
        require(liquidityAmount_ <= totalSupply_, "Liquidity exceeds supply");

        // Mintear tokens para liquidez al factory/deployer
        _mint(liquidityRecipient_, liquidityAmount_);

        // Mintear resto al distribuidor
        uint256 distributorAmount = totalSupply_ - liquidityAmount_;
        if (distributorAmount > 0) {
            _mint(distributorRecipient_, distributorAmount);
        }
    }
}
