// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

/**
 * Vendored VERBATIM from the Final ERC-7857 specification (CC0-1.0).
 * Source: https://github.com/ethereum/ERCs/blob/master/ERCS/erc-7857.md
 */

struct IntelligentData {
    string dataDescription;
    bytes32 dataHash;
}

interface IERC7857Metadata {
    /// @notice Get the name of the NFT collection
    function name() external view returns (string memory);

    /// @notice Get the symbol of the NFT collection
    function symbol() external view returns (string memory);

    /// @notice Get the data hash of a token
    /// @param _tokenId The token identifier
    /// @return The current data hash of the token
    function intelligentDataOf(uint256 _tokenId) external view returns (IntelligentData[] memory);
}
