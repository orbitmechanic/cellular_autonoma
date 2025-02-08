// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface INucleus {
    function getOrganelleName(
        address organelleAddress
    ) external view returns (string memory);
}

/**
 * @title Leucoplast
 * @dev Storage contract for a cell's basic funds and gas.
 *      It holds base tokens for transaction fees and cell reproduction.
 */
contract Leucoplast {
    address public nucleus;

    constructor(address _nucleus) {
        nucleus = _nucleus;
    }

    modifier onlyCellMember() {
        require(
            bytes(INucleus(nucleus).getOrganelleName(msg.sender)).length > 0,
            "Cannot withdraw by external Tx."
        );
        _;
    }

    receive() external payable {} // Accepts external funding

    function withdraw(
        address payable recipient,
        uint256 amount
    ) external onlyCellMember {
        uint256 maxWithdraw = address(this).balance / 2;
        require(amount <= maxWithdraw, "Exceeds max withdrawal limit");
        recipient.transfer(amount);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
