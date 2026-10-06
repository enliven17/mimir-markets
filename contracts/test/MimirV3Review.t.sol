// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3} from "../MimirV3.sol";

/**
 * One test (or more) per finding of the 2026-10-06 review (docs/ARC.md).
 * Dependency-free like the rest of the suite.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

/// A challenger that disputes, then tries to settle the claim a second time
/// from its receive() while the arbiter's ruling is paying it.
contract ReentrantDisputer {
    MimirV3 immutable m;
    uint256 public id;

    struct Seen {
        bool armed;
        bool called;
        uint8 state;
        bool reentered;
        bool stoppedByLock;
    }
    Seen public seen;

    constructor(MimirV3 _m) {
        m = _m;
        seen.armed = true;
    }

    function challenge(uint256 _id, uint256 stake) external payable {
        id = _id;
        m.challengeClaim{value: stake}(_id, stake, "", address(0));
    }

    function dispute(uint256 bond) external payable {
        m.disputeResolution{value: bond}(id);
    }

    receive() external payable {
        Seen memory s = seen;
        if (!s.armed) return;
        s.armed = false;
        s.called = true;
        (,,,,,,,,, s.state,,,,,,,,) = m.getClaim(id);
        (bool ok, bytes memory ret) = address(m).call(abi.encodeWithSelector(MimirV3.refundExpired.selector, id));
        s.reentered = ok;
        s.stoppedByLock = keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.Reentrant.selector));
        seen = s;
    }
}

/// ERC-20 whose transferFrom calls back into the escrow with all the gas it
/// has: no PUSH_GAS stipend on this path, so only the lock can stop it.
contract HookToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    MimirV3 public target;
    bytes public reentryCall;
    bool public reentered;
    bytes public reentryRet;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function arm(MimirV3 m, bytes calldata data) external {
        target = m;
        reentryCall = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (address(target) != address(0)) {
            (reentered, reentryRet) = address(target).call(reentryCall);
            target = MimirV3(payable(address(0)));
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// 6-decimal token with a real EIP-2612 permit (nonces, so a replay fails).
contract PermitToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("USDC"), keccak256("2"), block.chainid, address(this)
        ));
    }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "expired");
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))));
        require(ecrecover(digest, v, r, s) == owner, "bad sig");
        allowance[owner][spender] = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MimirV3ReviewTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant GAP = 1 days;
    uint256 constant WINDOW = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        mimir = new MimirV3(oracle, 50, 0, platform, address(0), WINDOW);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _create(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim{value: STAKE}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    function _lockError() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MimirV3.Reentrant.selector);
    }

    // ── #3 + #6: settle before paying the bond; reentrancy lock ────────────

    function test_aDisputerCannotSettleTwiceFromItsReceive() public {
        ReentrantDisputer d = new ReentrantDisputer(mimir);
        vm.deal(address(d), 100 * ONE);
        uint256 id = _create(creator);
        d.challenge{value: STAKE}(id, STAKE);

        vm.warp(block.timestamp + GAP + 1);
        uint8 creatorSide = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, creatorSide, "proposed", 90, bytes32(uint256(7)));
        uint256 bond = mimir.MIN_STAKE();
        d.dispute{value: bond}(bond);

        // Late in the dispute, the arbiter rules for the disputer: it is paid
        // its winnings and its bond, and tries to re-enter refundExpired.
        // (After the grace the ruling itself is refused: finding #2.)
        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS() - 1);
        mimir.resolveDispute(id, mimir.SIDE_CHALLENGERS(), "arbiter", 100, bytes32(uint256(8)));

        (, bool called, uint8 seenState, bool reentered, bool stoppedByLock) = d.seen();
        assert(called);
        // Every transfer happens after the claim is settled...
        assert(seenState == mimir.ST_RESOLVED());
        // ...and the second settlement is refused by the lock itself.
        assert(!reentered);
        assert(stoppedByLock);

        assert(mimir.totalResolved() == 1);
        assert(_state(id) == mimir.ST_RESOLVED());
        // Nothing left in the escrow but what it still owes.
        assert(
            address(mimir).balance
                == mimir.lifetimeFeesAccrued() - mimir.lifetimeFeesClaimed() + mimir.pendingWithdrawals(address(d))
        );
    }

    function test_theLockStopsAFullGasReentry() public {
        HookToken token = new HookToken();
        MimirV3 m = new MimirV3(oracle, 50, 0, platform, address(token), 0);
        token.mint(creator, 100e6);
        vm.prank(creator);
        token.approve(address(m), type(uint256).max);

        // During the stake pull (all gas forwarded), the token re-enters
        // refundExpired. Without the lock this would fail for another reason.
        token.arm(m, abi.encodeWithSelector(MimirV3.refundExpired.selector, uint256(1)));
        vm.prank(creator);
        m.createClaim(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, 10e6,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
        assert(!token.reentered());
        assert(keccak256(token.reentryRet()) == keccak256(_lockError()));
    }

    // ── #2: no verdict once the refund is open ──────────────────────────────

    function test_aLateVerdictIsRefusedOnceTheRefundIsOpen() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));

        vm.warp(block.timestamp + GAP + mimir.RESOLUTION_GRACE_SECONDS());
        bytes memory verdict = abi.encodeWithSelector(
            MimirV3.resolveClaim.selector, id, mimir.SIDE_CREATOR(), "late", uint8(90), bytes32(uint256(1))
        );
        vm.prank(oracle);
        (bool ok, bytes memory ret) = address(mimir).call(verdict);
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.GraceOver.selector)));

        // Whoever comes first, the refund is the only outcome.
        mimir.refundExpired(id);
        (,,,,,,,,,, uint8 side,,,,,,,) = mimir.getClaim(id);
        assert(side == mimir.SIDE_UNRESOLVABLE());
    }

    function test_aVerdictJustBeforeTheGraceStillLands() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));

        vm.warp(block.timestamp + GAP + mimir.RESOLUTION_GRACE_SECONDS() - 1);
        uint8 side = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "on time", 90, bytes32(uint256(1)));
        assert(_state(id) == mimir.ST_PROPOSED());
    }

    function test_aLateArbiterRulingIsRefusedOnceTheRefundIsOpen() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));
        vm.warp(block.timestamp + GAP + 1);
        uint8 creatorSide = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, creatorSide, "proposed", 90, bytes32(uint256(7)));
        uint256 bond = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);

        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS());
        (bool ok, bytes memory ret) = address(mimir).call(abi.encodeWithSelector(
            MimirV3.resolveDispute.selector, id, mimir.SIDE_CHALLENGERS(), "late", uint8(100), bytes32(0)
        ));
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.GraceOver.selector)));

        mimir.refundExpired(id);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(mimir.totalResolved() == 1);
    }

    // -- #4: timelocked ownership; an unruled dispute costs the bond -------

    function test_ownershipCannotBeAcceptedBeforeTheTimelock() public {
        mimir.transferOwnership(alice);
        assert(mimir.pendingOwnerEta() == block.timestamp + mimir.OWNERSHIP_TIMELOCK_SECONDS());

        vm.warp(block.timestamp + mimir.OWNERSHIP_TIMELOCK_SECONDS() - 1);
        vm.prank(alice);
        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.acceptOwnership.selector));
        assert(!early);
        assert(mimir.owner() == address(this));

        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        mimir.acceptOwnership();
        assert(mimir.owner() == alice);
        assert(mimir.pendingOwnerEta() == 0);
    }

    function test_aQueuedOwnershipTransferCanBeCancelled() public {
        mimir.transferOwnership(alice);

        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.cancelOwnershipTransfer.selector));
        assert(!stranger);

        mimir.cancelOwnershipTransfer();
        assert(mimir.pendingOwner() == address(0));
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.acceptOwnership.selector));
        assert(!ok);
        assert(mimir.owner() == address(this));
    }

    function test_stallingALossWithAnUnruledDisputeCostsTheBond() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));
        vm.warp(block.timestamp + GAP + 1);
        uint8 creatorSide = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, creatorSide, "creator wins", 90, bytes32(uint256(7)));

        // Alice lost. She disputes and the arbiter never rules.
        uint256 bond = mimir.MIN_STAKE();
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);
        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS());
        mimir.refundExpired(id);

        // Stake back, bond gone to the platform: stalling is not free.
        assert(alice.balance == aliceBefore - bond + STAKE);
        assert(mimir.accruedFees(platform) == bond);
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued() - mimir.lifetimeFeesClaimed());
    }

    // -- #1: agent payout wallets come from an owner-managed, timelocked list

    function _createWithAgent(address who, address agent) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(mimir).call{value: STAKE}(abi.encodeWithSelector(
            MimirV3.createClaim.selector,
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "rule", uint256(0), false, "", agent
        ));
    }

    function _challengeWithAgent(address who, uint256 id, address agent) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(mimir).call{value: STAKE}(
            abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, STAKE, "", agent)
        );
    }

    function test_aCallerCannotNameAnUnlistedAgentPayout() public {
        address thief = address(0x7E1F);
        assert(!_createWithAgent(creator, thief));

        uint256 id = _create(creator);
        assert(!_challengeWithAgent(alice, id, thief));
        // No attribution is always fine.
        assert(_challengeWithAgent(alice, id, address(0)));
    }

    function test_aListedAgentPayoutIsAcceptedOnlyAfterTheTimelock() public {
        address agent = address(0xA6E7);
        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setAgentPayout.selector, agent, true));
        assert(!stranger);

        mimir.setAgentPayout(agent, true);
        assert(mimir.agentPayoutSince(agent) == block.timestamp + mimir.FEE_TIMELOCK_SECONDS());
        vm.warp(block.timestamp + mimir.FEE_TIMELOCK_SECONDS() - 1);
        assert(!_createWithAgent(creator, agent));

        vm.warp(block.timestamp + 1);
        assert(_createWithAgent(creator, agent));
        uint256 id = mimir.claimCount();
        assert(_challengeWithAgent(alice, id, agent));
        (,,, address credited) = mimir.getClaimFees(id);
        assert(credited == agent);
    }

    function test_aDelistedAgentPayoutIsRefusedAtOnceButKeepsOpenPositions() public {
        address agent = address(0xA6E7);
        mimir.setAgentPayout(agent, true);
        vm.warp(block.timestamp + mimir.FEE_TIMELOCK_SECONDS());
        assert(_createWithAgent(creator, agent));
        uint256 id = mimir.claimCount();

        mimir.setAgentPayout(agent, false);
        assert(mimir.agentPayoutSince(agent) == 0);
        assert(!_createWithAgent(creator, agent));
        assert(!_challengeWithAgent(alice, id, agent));

        // The creator's own rematch would inherit a delisted agent: refused.
        vm.prank(creator);
        (bool rematch,) = address(mimir).call{value: STAKE}(abi.encodeWithSelector(
            MimirV3.createRematch.selector, id, block.timestamp + GAP, STAKE, ""
        ));
        assert(!rematch);

        // The open market keeps the agent it was created with.
        assert(_challengeWithAgent(alice, id, address(0)));
        (,,, address credited) = mimir.getClaimFees(id);
        assert(credited == agent);
    }

    function test_listingTwiceCannotResetTheTimelock() public {
        address agent = address(0xA6E7);
        mimir.setAgentPayout(agent, true);
        (bool again,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setAgentPayout.selector, agent, true));
        assert(!again);
        (bool zero,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setAgentPayout.selector, address(0), true));
        assert(!zero);
    }

    // -- #7: a front-run permit does not block the stake ------------------

    struct PermitCase {
        PermitToken usdc;
        MimirV3 m;
        address owner;
        uint256 id;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _permitCase(uint256 value) internal returns (PermitCase memory c) {
        c.usdc = new PermitToken();
        c.m = new MimirV3(oracle, 50, 0, platform, address(c.usdc), 0);
        uint256 key = 0xA11CE5;
        c.owner = vm.addr(key);
        c.usdc.mint(c.owner, 100e6);
        c.usdc.mint(creator, 100e6);
        vm.prank(creator);
        c.usdc.approve(address(c.m), 10e6);
        vm.prank(creator);
        c.id = c.m.createClaim(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, 10e6,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
        c.deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", c.usdc.DOMAIN_SEPARATOR(), keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            c.owner, address(c.m), value, uint256(0), c.deadline
        ))));
        (c.v, c.r, c.s) = vm.sign(key, digest);
    }

    function _permitAndStake(PermitCase memory c, uint256 value) internal returns (bool ok, bytes memory ret) {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(MimirV3.usdcPermit.selector, value, c.deadline, c.v, c.r, c.s);
        calls[1] = abi.encodeWithSelector(MimirV3.challengeClaim.selector, c.id, value, "", address(0));
        vm.prank(c.owner);
        (ok, ret) = address(c.m).call(abi.encodeWithSelector(MimirV3.multicall.selector, calls));
    }

    function test_aFrontRunPermitDoesNotBlockTheStake() public {
        PermitCase memory c = _permitCase(5e6);
        // Someone copies the signed permit from the mempool and submits it first.
        vm.prank(bob);
        c.usdc.permit(c.owner, address(c.m), 5e6, c.deadline, c.v, c.r, c.s);

        (bool ok,) = _permitAndStake(c, 5e6);
        assert(ok);
        assert(c.m.hasChallenged(c.id, c.owner));
        assert(c.usdc.balanceOf(c.owner) == 95e6);
    }

    function test_aFailedPermitWithoutAllowanceStillReverts() public {
        PermitCase memory c = _permitCase(5e6);
        c.s = bytes32(uint256(c.s) ^ 1); // corrupt the signature

        (bool ok, bytes memory ret) = _permitAndStake(c, 5e6);
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.PermitFailed.selector)));
        assert(!c.m.hasChallenged(c.id, c.owner));
    }

    // -- #8: an ERC-20 deployment needs a token with code -----------------

    function deployWithToken(address token) external returns (MimirV3) {
        return new MimirV3(oracle, 50, 0, platform, token, 0);
    }

    function test_aTokenWithoutCodeIsRefusedAtDeploy() public {
        (bool ok, bytes memory ret) =
            address(this).call(abi.encodeWithSelector(this.deployWithToken.selector, address(0xDEAD)));
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSignature("Error(string)", "Mimir: token has no code")));
    }

    function test_multicallStillWorksUnderTheLock() public {
        HookToken token = new HookToken();
        MimirV3 m = new MimirV3(oracle, 50, 0, platform, address(token), 0);
        token.mint(creator, 100e6);
        vm.prank(creator);
        token.approve(address(m), type(uint256).max);

        bytes memory create = abi.encodeWithSelector(
            MimirV3.createClaim.selector,
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, uint256(10e6),
            "custom", uint256(0), "binary", "pool", uint256(0), "", "rule", uint256(0), false, "", address(0)
        );
        bytes[] memory calls = new bytes[](2);
        calls[0] = create;
        calls[1] = create;
        vm.prank(creator);
        m.multicall(calls);
        assert(m.claimCount() == 2);
    }
}
