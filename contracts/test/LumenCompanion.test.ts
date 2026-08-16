import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ROOT_A = ethers.keccak256(ethers.toUtf8Bytes('snapshot-1'));
const ROOT_B = ethers.keccak256(ethers.toUtf8Bytes('snapshot-2'));
const ROOT_C = ethers.keccak256(ethers.toUtf8Bytes('snapshot-3'));
const ZERO_ROOT = ethers.ZeroHash;
const DESC = 'data:application/json,{"kind":"lumen-companion"}';

async function deploy() {
  const [owner, other, third] = await ethers.getSigners();
  const factory = await ethers.getContractFactory('LumenCompanion');
  const companion = await factory.deploy();
  await companion.waitForDeployment();
  return { companion, owner, other, third };
}

async function deployAndMint() {
  const ctx = await deploy();
  await ctx.companion.mint(ROOT_A, DESC);
  return ctx;
}

describe('LumenCompanion', () => {
  describe('mint', () => {
    it('mints token 1 to the caller with the memory root recorded', async () => {
      const { companion, owner } = await loadFixture(deploy);

      await expect(companion.mint(ROOT_A, DESC))
        .to.emit(companion, 'Minted')
        .withArgs(1n, owner.address, ROOT_A, DESC)
        .and.to.emit(companion, 'Transfer')
        .withArgs(ethers.ZeroAddress, owner.address, 1n);

      expect(await companion.companionOf(owner.address)).to.equal(1n);
      expect(await companion.ownerOf(1)).to.equal(owner.address);
      expect(await companion.latestMemoryRoot(1)).to.equal(ROOT_A);
      expect(await companion.anchorCount(1)).to.equal(0n);
      expect(await companion.tokenURI(1)).to.equal(DESC);

      const data = await companion.intelligentDataOf(1);
      expect(data.length).to.equal(1);
      expect(data[0].dataHash).to.equal(ROOT_A);
      expect(data[0].dataDescription).to.equal(DESC);
    });

    it('allows minting before the first save (zero root)', async () => {
      const { companion } = await loadFixture(deploy);
      await companion.mint(ZERO_ROOT, 'pre-save');
      expect(await companion.latestMemoryRoot(1)).to.equal(ZERO_ROOT);
    });

    it('enforces one companion per wallet, but not across wallets', async () => {
      const { companion, owner, other } = await loadFixture(deployAndMint);

      await expect(companion.mint(ROOT_B, DESC))
        .to.be.revertedWithCustomError(companion, 'AlreadyHasCompanion')
        .withArgs(owner.address, 1n);

      await companion.connect(other).mint(ROOT_B, DESC);
      expect(await companion.companionOf(other.address)).to.equal(2n);
      expect(await companion.companionOf(third_unused())).to.equal(0n);
    });

    function third_unused() {
      return ethers.Wallet.createRandom().address;
    }
  });

  describe('anchorMemoryRoot', () => {
    it('moves the pointer and emits a chained event', async () => {
      const { companion } = await loadFixture(deployAndMint);

      await expect(companion.anchorMemoryRoot(1, ROOT_B, ROOT_A))
        .to.emit(companion, 'MemoryRootAnchored')
        .withArgs(1n, 1n, ROOT_A, ROOT_B)
        .and.to.emit(companion, 'Updated')
        .withArgs(1n, [ROOT_A], [ROOT_B]);

      expect(await companion.latestMemoryRoot(1)).to.equal(ROOT_B);
      expect(await companion.anchorCount(1)).to.equal(1n);
    });

    it('anchors from a zero root (minted before first save)', async () => {
      const { companion } = await loadFixture(deploy);
      await companion.mint(ZERO_ROOT, 'pre-save');
      await expect(companion.anchorMemoryRoot(1, ROOT_A, ZERO_ROOT))
        .to.emit(companion, 'MemoryRootAnchored')
        .withArgs(1n, 1n, ZERO_ROOT, ROOT_A);
    });

    it('builds a verifiable chain across successive anchors', async () => {
      const { companion } = await loadFixture(deployAndMint);
      await companion.anchorMemoryRoot(1, ROOT_B, ROOT_A);
      await companion.anchorMemoryRoot(1, ROOT_C, ROOT_B);

      const events = await companion.queryFilter(companion.filters.MemoryRootAnchored(1n));
      expect(events.length).to.equal(2);
      // each anchor's prevRoot must equal the previous anchor's newRoot
      expect(events[0]!.args.prevRoot).to.equal(ROOT_A);
      expect(events[0]!.args.newRoot).to.equal(ROOT_B);
      expect(events[1]!.args.prevRoot).to.equal(events[0]!.args.newRoot);
      expect(events[1]!.args.newRoot).to.equal(ROOT_C);
      expect(events.map((e) => e.args.seq)).to.deep.equal([1n, 2n]);
    });

    it('rejects a non-owner', async () => {
      const { companion, other } = await loadFixture(deployAndMint);
      await expect(companion.connect(other).anchorMemoryRoot(1, ROOT_B, ROOT_A))
        .to.be.revertedWithCustomError(companion, 'NotTokenOwner')
        .withArgs(1n, other.address);
    });

    it('rejects a zero root, an unchanged root, and a stale CAS', async () => {
      const { companion } = await loadFixture(deployAndMint);

      await expect(
        companion.anchorMemoryRoot(1, ZERO_ROOT, ROOT_A),
      ).to.be.revertedWithCustomError(companion, 'ZeroRoot');

      await expect(companion.anchorMemoryRoot(1, ROOT_A, ROOT_A))
        .to.be.revertedWithCustomError(companion, 'SameRoot')
        .withArgs(ROOT_A);

      await expect(companion.anchorMemoryRoot(1, ROOT_B, ROOT_C))
        .to.be.revertedWithCustomError(companion, 'StaleAnchor')
        .withArgs(1n, ROOT_C, ROOT_A);
    });

    it('rejects an unknown token', async () => {
      const { companion } = await loadFixture(deployAndMint);
      await expect(
        companion.anchorMemoryRoot(99, ROOT_B, ROOT_A),
      ).to.be.revertedWithCustomError(companion, 'ERC721NonexistentToken');
    });
  });

  describe('update (0G reference alias)', () => {
    it('re-anchors without compare-and-swap and updates the description', async () => {
      const { companion } = await loadFixture(deployAndMint);

      await expect(companion.update(1, [{ dataDescription: 'v2', dataHash: ROOT_B }]))
        .to.emit(companion, 'MemoryRootAnchored')
        .withArgs(1n, 1n, ROOT_A, ROOT_B)
        .and.to.emit(companion, 'Updated')
        .withArgs(1n, [ROOT_A], [ROOT_B]);

      expect(await companion.latestMemoryRoot(1)).to.equal(ROOT_B);
      expect(await companion.tokenURI(1)).to.equal('v2');
    });

    it('accepts exactly one entry and rejects non-owners / zero roots', async () => {
      const { companion, other } = await loadFixture(deployAndMint);

      await expect(
        companion.update(1, [
          { dataDescription: 'a', dataHash: ROOT_B },
          { dataDescription: 'b', dataHash: ROOT_C },
        ]),
      ).to.be.revertedWithCustomError(companion, 'SingleDataEntryOnly');

      await expect(companion.update(1, [])).to.be.revertedWithCustomError(
        companion,
        'SingleDataEntryOnly',
      );

      await expect(
        companion.update(1, [{ dataDescription: 'z', dataHash: ZERO_ROOT }]),
      ).to.be.revertedWithCustomError(companion, 'ZeroRoot');

      await expect(
        companion.connect(other).update(1, [{ dataDescription: 'x', dataHash: ROOT_B }]),
      ).to.be.revertedWithCustomError(companion, 'NotTokenOwner');
    });

    it('exposes intelligentDatasOf as an alias of intelligentDataOf', async () => {
      const { companion } = await loadFixture(deployAndMint);
      const a = await companion.intelligentDataOf(1);
      const b = await companion.intelligentDatasOf(1);
      expect(b[0].dataHash).to.equal(a[0].dataHash);
      expect(b[0].dataDescription).to.equal(a[0].dataDescription);
    });
  });

  describe('soulbound until an oracle exists', () => {
    it('blocks transferFrom and both safeTransferFrom overloads', async () => {
      const { companion, owner, other } = await loadFixture(deployAndMint);

      await expect(
        companion.transferFrom(owner.address, other.address, 1),
      ).to.be.revertedWithCustomError(companion, 'TransferRequiresOracle');

      await expect(
        companion['safeTransferFrom(address,address,uint256)'](owner.address, other.address, 1),
      ).to.be.revertedWithCustomError(companion, 'TransferRequiresOracle');

      await expect(
        companion['safeTransferFrom(address,address,uint256,bytes)'](
          owner.address,
          other.address,
          1,
          '0x',
        ),
      ).to.be.revertedWithCustomError(companion, 'TransferRequiresOracle');

      expect(await companion.ownerOf(1)).to.equal(owner.address);
      expect(await companion.balanceOf(owner.address)).to.equal(1n);
      expect(await companion.balanceOf(other.address)).to.equal(0n);
    });

    it('lets approvals be granted but never acted upon', async () => {
      const { companion, owner, other } = await loadFixture(deployAndMint);

      await companion.approve(other.address, 1);
      expect(await companion.getApproved(1)).to.equal(other.address);

      await expect(
        companion.connect(other).transferFrom(owner.address, other.address, 1),
      ).to.be.revertedWithCustomError(companion, 'TransferRequiresOracle');

      await companion.setApprovalForAll(other.address, true);
      expect(await companion.isApprovedForAll(owner.address, other.address)).to.equal(true);
      await expect(
        companion.connect(other).transferFrom(owner.address, other.address, 1),
      ).to.be.revertedWithCustomError(companion, 'TransferRequiresOracle');
    });

    it('reverts ERC-7857 transfer/clone with OracleNotLive and reports no verifier', async () => {
      const { companion, other } = await loadFixture(deployAndMint);
      const emptyProofs: never[] = [];

      await expect(
        companion.iTransfer(other.address, 1, emptyProofs),
      ).to.be.revertedWithCustomError(companion, 'OracleNotLive');

      await expect(companion.iClone(other.address, 1, emptyProofs)).to.be.revertedWithCustomError(
        companion,
        'OracleNotLive',
      );

      const proof = {
        accessProof: {
          oldDataHash: ROOT_A,
          newDataHash: ROOT_B,
          nonce: '0x00',
          encryptedPubKey: '0x00',
          proof: '0x00',
        },
        ownershipProof: {
          oracleType: 0,
          oldDataHash: ROOT_A,
          newDataHash: ROOT_B,
          sealedKey: '0x00',
          encryptedPubKey: '0x00',
          nonce: '0x00',
          proof: '0x00',
        },
      };
      await expect(
        companion.iTransfer(other.address, 1, [proof]),
      ).to.be.revertedWithCustomError(companion, 'OracleNotLive');

      expect(await companion.verifier()).to.equal(ethers.ZeroAddress);
    });
  });

  describe('authorization', () => {
    it('authorizes, lists, and rejects duplicates / non-owners / zero address', async () => {
      const { companion, owner, other, third } = await loadFixture(deployAndMint);

      await expect(companion.authorizeUsage(1, other.address))
        .to.emit(companion, 'Authorization')
        .withArgs(owner.address, other.address, 1n);
      await companion.authorizeUsage(1, third.address);
      expect(await companion.authorizedUsersOf(1)).to.deep.equal([other.address, third.address]);

      await expect(companion.authorizeUsage(1, other.address))
        .to.be.revertedWithCustomError(companion, 'AlreadyAuthorized')
        .withArgs(1n, other.address);

      await expect(
        companion.authorizeUsage(1, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(companion, 'ZeroAddress');

      await expect(
        companion.connect(other).authorizeUsage(1, third.address),
      ).to.be.revertedWithCustomError(companion, 'NotTokenOwner');
    });

    it('revokes correctly, including the swap-and-pop middle case', async () => {
      const { companion, owner, other, third } = await loadFixture(deployAndMint);
      const extra = ethers.Wallet.createRandom().address;

      await companion.authorizeUsage(1, other.address);
      await companion.authorizeUsage(1, third.address);
      await companion.authorizeUsage(1, extra);

      await expect(companion.revokeAuthorization(1, other.address))
        .to.emit(companion, 'AuthorizationRevoked')
        .withArgs(owner.address, other.address, 1n);

      const remaining = await companion.authorizedUsersOf(1);
      expect(remaining).to.have.lengthOf(2);
      expect(remaining).to.include.members([third.address, extra]);
      expect(remaining).to.not.include(other.address);

      // the swapped-in entry must still be revocable (index bookkeeping intact)
      await companion.revokeAuthorization(1, extra);
      expect(await companion.authorizedUsersOf(1)).to.deep.equal([third.address]);

      await expect(companion.revokeAuthorization(1, other.address))
        .to.be.revertedWithCustomError(companion, 'NotAuthorizedUser')
        .withArgs(1n, other.address);
    });

    it('records delegate access', async () => {
      const { companion, owner, other, third } = await loadFixture(deployAndMint);
      await expect(companion.delegateAccess(other.address))
        .to.emit(companion, 'DelegateAccess')
        .withArgs(owner.address, other.address);
      expect(await companion.getDelegateAccess(owner.address)).to.equal(other.address);

      await companion.delegateAccess(third.address);
      expect(await companion.getDelegateAccess(owner.address)).to.equal(third.address);
    });
  });

  describe('interfaces + gas', () => {
    it('reports ERC-165, ERC-721 and both ERC-7857 interfaces', async () => {
      const { companion } = await loadFixture(deploy);
      const ids = await (await ethers.getContractFactory('InterfaceIds')).deploy();

      expect(await companion.supportsInterface('0x01ffc9a7')).to.equal(true); // ERC165
      expect(await companion.supportsInterface('0x80ac58cd')).to.equal(true); // ERC721
      expect(await companion.supportsInterface(await ids.erc7857())).to.equal(true);
      expect(await companion.supportsInterface(await ids.erc7857Metadata())).to.equal(true);
      expect(await companion.supportsInterface('0xffffffff')).to.equal(false);
    });

    it('keeps mint and anchor cheap', async () => {
      const { companion } = await loadFixture(deploy);

      const mintReceipt = await (await companion.mint(ROOT_A, DESC)).wait();
      const anchorReceipt = await (await companion.anchorMemoryRoot(1, ROOT_B, ROOT_A)).wait();

      console.log(
        `      gas — mint: ${mintReceipt!.gasUsed}, anchor: ${anchorReceipt!.gasUsed}`,
      );
      expect(mintReceipt!.gasUsed).to.be.lessThan(250_000n);
      expect(anchorReceipt!.gasUsed).to.be.lessThan(100_000n);
    });
  });
});
