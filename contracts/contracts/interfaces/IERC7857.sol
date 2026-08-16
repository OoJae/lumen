// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

import {IERC7857DataVerifier, TransferValidityProof} from './IERC7857DataVerifier.sol';

/**
 * Vendored from the Final ERC-7857 specification (CC0-1.0).
 * Source: https://github.com/ethereum/ERCs/blob/master/ERCS/erc-7857.md
 *
 * ONE DOCUMENTED EDIT: the spec's `Approval` and `ApprovalForAll` event
 * declarations are omitted here. They are byte-identical to the ones already
 * declared in OpenZeppelin's IERC721, and Solidity rejects the duplicate
 * declaration when a contract inherits both. Omitting events does NOT change
 * type(IERC7857).interfaceId, which XORs function selectors only — so
 * supportsInterface still reports exact spec compliance. Every function and
 * every non-ERC721 event is verbatim.
 */
interface IERC7857 {
    /// @notice The event emitted when an address is authorized to use a token
    event Authorization(
        address indexed _from,
        address indexed _to,
        uint256 indexed _tokenId
    );

    /// @notice The event emitted when an address is revoked from using a token
    event AuthorizationRevoked(
        address indexed _from,
        address indexed _to,
        uint256 indexed _tokenId
    );

    /// @notice The event emitted when a token is transferred
    event Transferred(
        uint256 _tokenId,
        address indexed _from,
        address indexed _to
    );

    /// @notice The event emitted when a token is cloned
    event Cloned(
        uint256 indexed _tokenId,
        uint256 indexed _newTokenId,
        address _from,
        address _to
    );

    /// @notice The event emitted when a sealed key is published
    event PublishedSealedKey(
        address indexed _to,
        uint256 indexed _tokenId,
        bytes[] _sealedKeys
    );

    /// @notice The event emitted when a user is delegated to an assistant
    event DelegateAccess(address indexed _user, address indexed _assistant);

    /// @notice The verifier interface that this NFT uses
    function verifier() external view returns (IERC7857DataVerifier);

    /// @notice Transfer data with ownership
    function iTransfer(
        address _to,
        uint256 _tokenId,
        TransferValidityProof[] calldata _proofs
    ) external;

    /// @notice Clone data
    function iClone(
        address _to,
        uint256 _tokenId,
        TransferValidityProof[] calldata _proofs
    ) external returns (uint256 _newTokenId);

    /// @notice Add authorized user to group
    function authorizeUsage(uint256 _tokenId, address _user) external;

    /// @notice Revoke authorization from a user
    function revokeAuthorization(uint256 _tokenId, address _user) external;

    /// @notice Approve an address to transfer a token
    function approve(address _to, uint256 _tokenId) external;

    /// @notice Set approval for all
    function setApprovalForAll(address _operator, bool _approved) external;

    /// @notice Delegate access check to an assistant
    function delegateAccess(address _assistant) external;

    /// @notice Get token owner
    function ownerOf(uint256 _tokenId) external view returns (address);

    /// @notice Get the authorized users of a token
    function authorizedUsersOf(
        uint256 _tokenId
    ) external view returns (address[] memory);

    /// @notice Get the approved address for a token
    function getApproved(uint256 _tokenId) external view returns (address);

    /// @notice Check if an address is approved for all
    function isApprovedForAll(
        address _owner,
        address _operator
    ) external view returns (bool);

    /// @notice Get the delegate access for a user
    function getDelegateAccess(address _user) external view returns (address);
}
