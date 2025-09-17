// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimplePaymaster
 * @dev A basic paymaster for EntryPoint v0.8 that sponsors all operations
 */
contract SimplePaymaster is Ownable {
    uint256 public constant VALID_TIMESTAMP_OFFSET = 20;
    uint256 public constant VALID_TIMESTAMP_LENGTH = 6;

    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint) Ownable(msg.sender) {
        entryPoint = _entryPoint;
    }

    /**
     * @dev Validate the paymaster context and sponsor the operation
     * @param userOp The user operation to validate
     * @param userOpHash Hash of the user operation
     * @param maxCost Maximum cost in wei that the paymaster will pay
     * @return context Paymaster context (empty for this simple paymaster)
     * @return validationData Validation result (0 = success)
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external view returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "Sender not EntryPoint");
        
        // Simple validation - sponsor all operations if we have enough balance
        require(address(this).balance >= maxCost, "Insufficient paymaster balance");
        
        // Return success validation
        return ("", 0);
    }

    /**
     * @dev Post-operation hook (optional)
     * @param mode Post-op mode (0 = success, 1 = revert, 2 = postOp revert)
     * @param context Context from validatePaymasterUserOp
     * @param actualGasCost Actual gas cost of the operation
     * @param actualUserOpFeePerGas Actual fee per gas unit
     */
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external {
        require(msg.sender == address(entryPoint), "Sender not EntryPoint");
        // No post-operation logic needed for this simple paymaster
    }

    /**
     * @dev Deposit funds to the EntryPoint for this paymaster
     */
    function deposit() public payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /**
     * @dev Withdraw funds from the EntryPoint
     * @param withdrawAddress Address to withdraw to
     * @param amount Amount to withdraw
     */
    function withdrawTo(address payable withdrawAddress, uint256 amount) public onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    /**
     * @dev Add stake to the EntryPoint
     * @param unstakeDelaySec Unstake delay in seconds
     */
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    /**
     * @dev Unlock stake
     */
    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    /**
     * @dev Withdraw stake
     * @param withdrawAddress Address to withdraw to
     */
    function withdrawStake(address payable withdrawAddress) external onlyOwner {
        entryPoint.withdrawStake(withdrawAddress);
    }

    /**
     * @dev Get deposit info for this paymaster
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /**
     * @dev Receive ETH deposits
     */
    receive() external payable {
        deposit();
    }
}

// Minimal interfaces for EntryPoint v0.8
interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawStake(address payable withdrawAddress) external;
    function balanceOf(address account) external view returns (uint256);
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}
