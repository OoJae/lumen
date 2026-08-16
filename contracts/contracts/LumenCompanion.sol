// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {IERC7857} from './interfaces/IERC7857.sol';
import {IERC7857Metadata, IntelligentData} from './interfaces/IERC7857Metadata.sol';
import {IERC7857DataVerifier, TransferValidityProof} from './interfaces/IERC7857DataVerifier.sol';

/**
 * @title LumenCompanion — an ERC-7857 intelligent NFT for a private AI journal
 * @notice Your companion, on-chain. The token holds a POINTER to your journal,
 *         never your journal: `dataHash` is the 0G Storage merkle root of a
 *         snapshot that was encrypted on your device with a key derived from
 *         your wallet signature. Lumen cannot read it. Neither can this chain.
 *
 * Design invariants (all enforced below, all deliberate):
 *  1. ONE companion per wallet, minted to self. A companion is not a
 *     collectible; it is the on-chain identity of one person's memory.
 *  2. Exactly ONE IntelligentData entry per token — the current memory root.
 *     Anchors form a compare-and-swap chain (`expectedPrevRoot`) mirroring the
 *     off-chain snapshot's `prevRootHash` chain, which upgrades that chain from
 *     tamper-EVIDENT to rollback-PROTECTED for anchored roots.
 *  3. ZERO admin keys. No owner, no pause, no upgrade, no mint fee, no
 *     settable verifier. Lumen holds no power over anyone's companion — the
 *     strongest form of the ownership claim we make.
 *  4. SOULBOUND UNTIL AN ORACLE EXISTS. ERC-7857 transfers require a TEE
 *     re-encryption oracle. 0G's reference oracle address is an inert EOA with
 *     no published signing service (verified 2026-08), so rather than ship a
 *     transfer we cannot honour — or appoint ourselves the "TEE" — transfers
 *     revert. See `iTransfer` and `_update`.
 *
 * Compliance note: this contract implements the FINAL ERC-7857 interface
 * (ethereum/ERCs), and additionally exposes two aliases matching 0G's reference
 * implementation (`intelligentDatasOf`, `update`) so tooling written against
 * either shape works. contracts/README.md carries the full divergence table.
 */
contract LumenCompanion is ERC721, IERC7857, IERC7857Metadata {
    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 private _nextTokenId = 1; // 0 is the "no companion" sentinel
    mapping(address => uint256) private _companionOf;
    mapping(uint256 => IntelligentData[]) private _data; // always exactly 1 entry
    mapping(uint256 => uint64) public anchorCount; // 0 immediately after mint
    mapping(uint256 => address[]) private _authorizedUsers;
    mapping(uint256 => mapping(address => uint256)) private _authorizedIndex; // 1-based
    mapping(address => address) private _delegates;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error AlreadyHasCompanion(address owner, uint256 tokenId);
    error NotTokenOwner(uint256 tokenId, address caller);
    error ZeroRoot();
    error SameRoot(bytes32 root);
    error StaleAnchor(uint256 tokenId, bytes32 expectedPrev, bytes32 actualLatest);
    error OracleNotLive();
    error TransferRequiresOracle();
    error ZeroAddress();
    error AlreadyAuthorized(uint256 tokenId, address user);
    error NotAuthorizedUser(uint256 tokenId, address user);
    error SingleDataEntryOnly();

    // ─── Events (beyond the vendored interfaces) ──────────────────────────────

    /// @notice A companion was created. (0G reference parity.)
    event Minted(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 memoryRoot,
        string dataDescription
    );

    /// @notice Intelligent data replaced. (0G reference parity.)
    event Updated(uint256 indexed tokenId, bytes32[] oldDataHashes, bytes32[] newDataHashes);

    /// @notice The memory pointer moved. `seq` mirrors the off-chain snapshot
    ///         counter; `prevRoot` makes the on-chain history a verifiable chain.
    event MemoryRootAnchored(
        uint256 indexed tokenId,
        uint64 indexed seq,
        bytes32 prevRoot,
        bytes32 newRoot
    );

    constructor() ERC721('Lumen Companion', 'LUMEN') {}

    // ─── Mint ─────────────────────────────────────────────────────────────────

    /**
     * @notice Mint your companion. One per wallet, always to yourself.
     * @param memoryRoot 0G Storage merkle root of your encrypted snapshot.
     *                   May be bytes32(0) if you mint before your first save.
     * @param dataDescription Free-form label or data: URI. Never plaintext journal content.
     */
    function mint(
        bytes32 memoryRoot,
        string calldata dataDescription
    ) external returns (uint256 tokenId) {
        uint256 existing = _companionOf[msg.sender];
        if (existing != 0) revert AlreadyHasCompanion(msg.sender, existing);

        tokenId = _nextTokenId++;
        _companionOf[msg.sender] = tokenId;
        _data[tokenId].push(IntelligentData({dataDescription: dataDescription, dataHash: memoryRoot}));

        // Plain _mint, not _safeMint: minting is always to msg.sender, so there
        // is no untrusted receiver to call back into.
        _mint(msg.sender, tokenId);

        emit Minted(tokenId, msg.sender, memoryRoot, dataDescription);
    }

    // ─── Anchor ───────────────────────────────────────────────────────────────

    /**
     * @notice Move your companion's memory pointer to a newer snapshot root.
     * @dev Compare-and-swap: `expectedPrevRoot` must equal the current root, so
     *      two devices cannot silently clobber each other and the event log is a
     *      verifiable chain. Owner only — not approved operators: the memory
     *      pointer is personal, and approvals cannot move a soulbound token anyway.
     */
    function anchorMemoryRoot(
        uint256 tokenId,
        bytes32 newRoot,
        bytes32 expectedPrevRoot
    ) external {
        _requireTokenOwner(tokenId);
        if (newRoot == bytes32(0)) revert ZeroRoot();

        bytes32 current = _data[tokenId][0].dataHash;
        if (current == newRoot) revert SameRoot(newRoot);
        if (current != expectedPrevRoot) revert StaleAnchor(tokenId, expectedPrevRoot, current);

        _anchor(tokenId, current, newRoot);
    }

    /**
     * @notice 0G-reference-compatible alias for re-anchoring.
     * @dev Mirrors `AgentNFT.update(tokenId, newDatas)`: owner-only, replaces the
     *      data array, no compare-and-swap. Prefer `anchorMemoryRoot`, which
     *      additionally protects against racing writes. Exactly one entry is
     *      accepted — a Lumen companion tracks exactly one memory root.
     */
    function update(uint256 tokenId, IntelligentData[] calldata newDatas) external {
        _requireTokenOwner(tokenId);
        if (newDatas.length != 1) revert SingleDataEntryOnly();
        bytes32 newRoot = newDatas[0].dataHash;
        if (newRoot == bytes32(0)) revert ZeroRoot();

        bytes32 current = _data[tokenId][0].dataHash;
        if (current == newRoot) revert SameRoot(newRoot);

        _data[tokenId][0].dataDescription = newDatas[0].dataDescription;
        _anchor(tokenId, current, newRoot);
    }

    function _anchor(uint256 tokenId, bytes32 prevRoot, bytes32 newRoot) private {
        _data[tokenId][0].dataHash = newRoot;
        uint64 seq = ++anchorCount[tokenId];

        bytes32[] memory oldHashes = new bytes32[](1);
        bytes32[] memory newHashes = new bytes32[](1);
        oldHashes[0] = prevRoot;
        newHashes[0] = newRoot;

        emit MemoryRootAnchored(tokenId, seq, prevRoot, newRoot);
        emit Updated(tokenId, oldHashes, newHashes);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice The caller-facing mint-state read: 0 means "no companion yet".
    function companionOf(address owner) external view returns (uint256) {
        return _companionOf[owner];
    }

    /// @notice Current memory root (0G Storage merkle root of encrypted data).
    function latestMemoryRoot(uint256 tokenId) external view returns (bytes32) {
        _requireOwned(tokenId);
        return _data[tokenId][0].dataHash;
    }

    /// @inheritdoc IERC7857Metadata
    function intelligentDataOf(
        uint256 tokenId
    ) public view returns (IntelligentData[] memory) {
        _requireOwned(tokenId);
        return _data[tokenId];
    }

    /// @notice 0G-reference-compatible alias of {intelligentDataOf}.
    function intelligentDatasOf(
        uint256 tokenId
    ) external view returns (IntelligentData[] memory) {
        return intelligentDataOf(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _data[tokenId][0].dataDescription;
    }

    // ─── ERC-7857 transfer surface: honestly disabled ─────────────────────────

    /**
     * @inheritdoc IERC7857
     * @dev Always reverts. A compliant ERC-7857 transfer re-encrypts the private
     *      metadata to the recipient and proves it via a TEE oracle. 0G's
     *      reference oracle is not a public service (its address holds no code
     *      and has never transacted), and appointing our own key as "the TEE"
     *      would be theatre. Until a real oracle exists, your companion cannot
     *      be transferred — and we say so on-chain rather than in a footnote.
     */
    function iTransfer(address, uint256, TransferValidityProof[] calldata) external pure {
        revert OracleNotLive();
    }

    /// @inheritdoc IERC7857
    /// @dev Always reverts, for the same reason as {iTransfer}.
    function iClone(
        address,
        uint256,
        TransferValidityProof[] calldata
    ) external pure returns (uint256) {
        revert OracleNotLive();
    }

    /// @inheritdoc IERC7857
    /// @dev address(0): no verifier is wired, because no live oracle exists.
    function verifier() external pure returns (IERC7857DataVerifier) {
        return IERC7857DataVerifier(address(0));
    }

    // ─── Authorization (ERC-7857) ─────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function authorizeUsage(uint256 tokenId, address user) external {
        _requireTokenOwner(tokenId);
        if (user == address(0)) revert ZeroAddress();
        if (_authorizedIndex[tokenId][user] != 0) revert AlreadyAuthorized(tokenId, user);

        _authorizedUsers[tokenId].push(user);
        _authorizedIndex[tokenId][user] = _authorizedUsers[tokenId].length; // 1-based
        emit Authorization(msg.sender, user, tokenId);
    }

    /// @inheritdoc IERC7857
    function revokeAuthorization(uint256 tokenId, address user) external {
        _requireTokenOwner(tokenId);
        uint256 index = _authorizedIndex[tokenId][user];
        if (index == 0) revert NotAuthorizedUser(tokenId, user);

        address[] storage users = _authorizedUsers[tokenId];
        uint256 lastIndex = users.length;
        if (index != lastIndex) {
            address moved = users[lastIndex - 1];
            users[index - 1] = moved;
            _authorizedIndex[tokenId][moved] = index;
        }
        users.pop();
        delete _authorizedIndex[tokenId][user];

        emit AuthorizationRevoked(msg.sender, user, tokenId);
    }

    /// @inheritdoc IERC7857
    function authorizedUsersOf(uint256 tokenId) external view returns (address[] memory) {
        _requireOwned(tokenId);
        return _authorizedUsers[tokenId];
    }

    /// @inheritdoc IERC7857
    function delegateAccess(address assistant) external {
        _delegates[msg.sender] = assistant;
        emit DelegateAccess(msg.sender, assistant);
    }

    /// @inheritdoc IERC7857
    function getDelegateAccess(address user) external view returns (address) {
        return _delegates[user];
    }

    // ─── ERC-721 / ERC-7857 overlap ───────────────────────────────────────────
    // Both the vendored spec interfaces and OZ's ERC721 declare these, so
    // Solidity requires an explicit override naming both bases. Behaviour is
    // unchanged — each simply delegates to the ERC721 implementation. Note that
    // approvals can be granted but can never move a token (see {_update}).

    function name() public view override(ERC721, IERC7857Metadata) returns (string memory) {
        return super.name();
    }

    function symbol() public view override(ERC721, IERC7857Metadata) returns (string memory) {
        return super.symbol();
    }

    function ownerOf(uint256 tokenId) public view override(ERC721, IERC7857) returns (address) {
        return super.ownerOf(tokenId);
    }

    function approve(address to, uint256 tokenId) public override(ERC721, IERC7857) {
        super.approve(to, tokenId);
    }

    function getApproved(
        uint256 tokenId
    ) public view override(ERC721, IERC7857) returns (address) {
        return super.getApproved(tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public override(ERC721, IERC7857) {
        super.setApprovalForAll(operator, approved);
    }

    function isApprovedForAll(
        address owner,
        address operator
    ) public view override(ERC721, IERC7857) returns (bool) {
        return super.isApprovedForAll(owner, operator);
    }

    // ─── Soulbound enforcement ────────────────────────────────────────────────

    /**
     * @dev Single choke point for every ERC-721 movement. Mint (from == 0) is
     *      allowed; transfer and burn are not. Approvals still succeed — they
     *      simply can never be acted upon — which keeps the ERC-721 surface
     *      intact and honest.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) revert TransferRequiresOracle();
        return super._update(to, tokenId, auth);
    }

    function _requireTokenOwner(uint256 tokenId) private view {
        if (_requireOwned(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return
            interfaceId == type(IERC7857).interfaceId ||
            interfaceId == type(IERC7857Metadata).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
