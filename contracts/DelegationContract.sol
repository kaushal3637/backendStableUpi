// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title EIP7702DelegationContract
 * @dev A secure delegation contract for EIP-7702 that acts as delegated code for EOAs
 * @notice This contract is designed to be set as the code for an EOA via EIP-7702 delegation
 */
contract EIP7702DelegationContract {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    // Storage for nonces to prevent replay attacks
    mapping(address => uint256) private nonces;

    // Events
    event ExecutionSuccess(address indexed account, uint256 callsCount, uint256 nonce);
    event CallExecuted(address indexed target, uint256 value, bool success);
    event DelegationRevoked(address indexed account);

    // Custom errors for gas efficiency
    error NoCallsProvided();
    error CallFailed(uint256 index, string reason);
    error InvalidSignature();
    error InsufficientBalance();
    error InvalidNonce();

    /**
     * @dev Executes multiple calls with user signature verification for sponsored transactions
     * @param calls Array of Call structs to execute
     * @param userSignature Signature from the EOA owner authorizing these calls
     * @param nonce Nonce to prevent replay attacks
     */
    function execute(
        Call[] calldata calls, 
        bytes calldata userSignature, 
        uint256 nonce
    ) external {
        if (calls.length == 0) {
            revert NoCallsProvided();
        }

        // Get the EOA address (in EIP-7702, address(this) is the delegated EOA)
        address eoaOwner = address(this);
        
        // Verify nonce to prevent replay attacks
        if (nonces[eoaOwner] != nonce) {
            revert InvalidNonce();
        }
        
        // Increment nonce
        nonces[eoaOwner]++;

        // Create message hash for signature verification
        bytes32 messageHash = _createMessageHash(calls, nonce, eoaOwner);
        
        // Verify the signature is from the EOA owner
        address recoveredSigner = messageHash.toEthSignedMessageHash().recover(userSignature);
        if (recoveredSigner != eoaOwner) {
            revert InvalidSignature();
        }

        // Check total value required
        uint256 totalValue = 0;
        for (uint256 i = 0; i < calls.length; i++) {
            totalValue += calls[i].value;
        }
        
        if (address(this).balance < totalValue) {
            revert InsufficientBalance();
        }

        // Execute all calls
        for (uint256 i = 0; i < calls.length; i++) {
            Call calldata call = calls[i];
            
            (bool success, bytes memory returnData) = call.target.call{value: call.value}(call.data);
            
            emit CallExecuted(call.target, call.value, success);
            
            if (!success) {
                string memory revertReason = _getRevertMsg(returnData);
                revert CallFailed(i, revertReason);
            }
        }

        emit ExecutionSuccess(eoaOwner, calls.length, nonce);
    }

    /**
     * @dev Direct execution by EOA owner (no signature verification needed)
     * @param calls Array of Call structs to execute
     */
    function executeDirect(Call[] calldata calls) external {
        // Only allow direct execution if called by the EOA itself
        if (msg.sender != address(this)) {
            revert InvalidSignature();
        }

        if (calls.length == 0) {
            revert NoCallsProvided();
        }

        // Check total value required
        uint256 totalValue = 0;
        for (uint256 i = 0; i < calls.length; i++) {
            totalValue += calls[i].value;
        }
        
        if (address(this).balance < totalValue) {
            revert InsufficientBalance();
        }

        // Execute all calls
        for (uint256 i = 0; i < calls.length; i++) {
            Call calldata call = calls[i];
            
            (bool success, bytes memory returnData) = call.target.call{value: call.value}(call.data);
            
            emit CallExecuted(call.target, call.value, success);
            
            if (!success) {
                string memory revertReason = _getRevertMsg(returnData);
                revert CallFailed(i, revertReason);
            }
        }

        emit ExecutionSuccess(address(this), calls.length, nonces[address(this)]);
    }

    /**
     * @dev Allows the EOA owner to revoke delegation and return to normal EOA behavior
     * @notice This sets the account code back to empty, reverting to standard EOA
     */
    function revokeDelegation() external {
        if (msg.sender != address(this)) {
            revert InvalidSignature();
        }

        emit DelegationRevoked(address(this));
        
        // Note: Actual revocation would be done through EIP-7702 transaction type
        // This function serves as a marker for intent
    }

    /**
     * @dev Emergency function to execute a single call with signature
     * @param target The target contract to call
     * @param value The amount of ETH to send
     * @param data The call data
     * @param userSignature Signature from the EOA owner
     * @param nonce Nonce for replay protection
     */
    function emergencyCall(
        address target, 
        uint256 value, 
        bytes calldata data,
        bytes calldata userSignature,
        uint256 nonce
    ) external returns (bytes memory) {
        address eoaOwner = address(this);
        
        // Verify nonce
        if (nonces[eoaOwner] != nonce) {
            revert InvalidNonce();
        }
        
        // Increment nonce
        nonces[eoaOwner]++;

        // Create message hash for emergency call
        bytes32 messageHash = keccak256(abi.encodePacked(
            target,
            value,
            data,
            nonce,
            eoaOwner,
            "EMERGENCY"
        ));
        
        // Verify signature
        address recoveredSigner = messageHash.toEthSignedMessageHash().recover(userSignature);
        if (recoveredSigner != eoaOwner) {
            revert InvalidSignature();
        }

        if (address(this).balance < value) {
            revert InsufficientBalance();
        }

        (bool success, bytes memory returnData) = target.call{value: value}(data);
        
        if (!success) {
            string memory revertReason = _getRevertMsg(returnData);
            revert(string(abi.encodePacked("Emergency call failed: ", revertReason)));
        }

        return returnData;
    }

    /**
     * @dev Get the current nonce for an EOA
     * @param eoa The EOA address to get nonce for
     * @return The current nonce
     */
    function getNonce(address eoa) external view returns (uint256) {
        return nonces[eoa];
    }

    /**
     * @dev View function to check if delegation is active
     * @return bool indicating if this contract is currently delegated code for the calling EOA
     */
    function isDelegationActive() external view returns (bool) {
        // In EIP-7702, if we're running as delegated code, msg.sender == address(this)
        return msg.sender == address(this);
    }

    /**
     * @dev Get the balance of the EOA account
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @dev Verify a signature for a set of calls
     * @param calls The calls to verify
     * @param userSignature The signature to verify
     * @param nonce The nonce used in the signature
     * @param eoaOwner The expected signer address
     * @return True if signature is valid
     */
    function verifySignature(
        Call[] calldata calls,
        bytes calldata userSignature,
        uint256 nonce,
        address eoaOwner
    ) external view returns (bool) {
        bytes32 messageHash = _createMessageHash(calls, nonce, eoaOwner);
        address recoveredSigner = messageHash.toEthSignedMessageHash().recover(userSignature);
        return recoveredSigner == eoaOwner;
    }

    /**
     * @dev Creates a message hash for the given calls
     * @param calls The calls to hash
     * @param nonce The nonce to include
     * @param eoaOwner The EOA owner address
     * @return The message hash
     */
    function _createMessageHash(
        Call[] calldata calls,
        uint256 nonce,
        address eoaOwner
    ) internal pure returns (bytes32) {
        // Extract arrays for hashing
        address[] memory targets = new address[](calls.length);
        uint256[] memory values = new uint256[](calls.length);
        bytes32[] memory dataHashes = new bytes32[](calls.length);
        
        for (uint256 i = 0; i < calls.length; i++) {
            targets[i] = calls[i].target;
            values[i] = calls[i].value;
            dataHashes[i] = keccak256(calls[i].data);
        }
        
        return keccak256(abi.encodePacked(
            targets,
            values,
            dataHashes,
            nonce,
            eoaOwner
        ));
    }

    /**
     * @dev Extracts revert reason from failed call return data
     */
    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) return "Call reverted silently";

        assembly {
            // Skip the first 32 bytes (array length) and 4 bytes (function selector)
            returnData := add(returnData, 0x04)
        }

        return abi.decode(returnData, (string));
    }

    /**
     * @dev Allow the EOA to receive ETH when this is delegated code
     */
    receive() external payable {
        // ETH can be received normally
    }

    /**
     * @dev Fallback function for unknown function calls
     * @notice Reverts to prevent accidental calls to unknown functions
     */
    fallback() external payable {
        revert("Function not found");
    }
}