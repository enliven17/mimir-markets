// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3} from "../MimirV3.sol";

/**
 * Invariants on the money, over random sequences of create / challenge /
 * resolve / dispute / finalize / arbitrate / refund / cancel / withdraw /
 * claimFees and the clock:
 *
 *   1. The escrow's native balance covers everything it owes: parked payouts,
 *      accrued fees, and every stake and bond of a market not yet settled.
 *   2. The fee books agree: accrued minus claimed equals the open fee balances.
 *   3. No winner (and nobody refunded) ever gets back less than their stake.
 *
 * Dependency-free: forge reads targetContracts() by selector, no forge-std.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

/// A participant that can be switched to refuse payouts, so parking is exercised.
contract Refuser {
    bool public refuse;

    function toggle() external {
        refuse = !refuse;
    }

    receive() external payable {
        if (refuse) revert("refused");
    }
}

contract Handler {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant ONE = 1e18;
    uint256 constant MAX_CLAIMS = 24;

    MimirV3 public immutable m;
    address public immutable owner;
    address public immutable oracle;
    address public immutable agent;
    address public immutable platform;
    Refuser public immutable refuser;
    uint256 public immutable window;

    address[] public actors;
    /// The clock, tracked here: block.timestamp can read stale after vm.warp under via-IR.
    uint256 public t;
    bool public principalViolated;
    uint256 public settlements;

    constructor(
        MimirV3 _m,
        address _owner,
        address _oracle,
        address _agent,
        address _platform,
        Refuser _refuser,
        address[] memory _actors,
        uint256 _t
    ) payable {
        m = _m;
        owner = _owner;
        oracle = _oracle;
        agent = _agent;
        platform = _platform;
        refuser = _refuser;
        actors = _actors;
        t = _t;
        window = _m.disputeWindow();
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    /// First claim from a random start whose state is `a` or `b` (0 if none),
    /// so actions land on claims they can move instead of mostly no-op'ing.
    function _find(uint256 s, uint8 a, uint8 b) internal view returns (uint256) {
        uint256 n = m.claimCount();
        for (uint256 k = 0; k < n; k++) {
            uint256 id = 1 + ((s % n + k) % n);
            uint8 st = _state(id);
            if (st == a || st == b) return id;
        }
        return 0;
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = m.getClaim(id);
    }

    function _deadline(uint256 id) internal view returns (uint256 d) {
        (,,,,,,,, d,,,,,,,,,) = m.getClaim(id);
    }

    function _advanceTo(uint256 when) internal {
        if (t < when) {
            t = when;
            vm.warp(t);
        }
    }

    function _participants(uint256 id)
        internal
        view
        returns (address[] memory who, uint256[] memory stake, uint256[] memory before)
    {
        (address creator,,,,, uint256 creatorStake,,,,,,,,,,,,) = m.getClaim(id);
        (address[] memory ch, uint256[] memory chStake) = m.getChallengerList(id);
        who = new address[](ch.length + 1);
        stake = new uint256[](ch.length + 1);
        before = new uint256[](ch.length + 1);
        who[0] = creator;
        stake[0] = creatorStake;
        for (uint256 i = 0; i < ch.length; i++) {
            who[i + 1] = ch[i];
            stake[i + 1] = chStake[i];
        }
        for (uint256 i = 0; i < who.length; i++) {
            before[i] = who[i].balance + m.pendingWithdrawals(who[i]);
        }
    }

    /// After a settlement: every winner (everyone, on a draw or refund) is up by at least their stake.
    function _checkPrincipal(uint256 id, address[] memory who, uint256[] memory stake, uint256[] memory before)
        internal
    {
        settlements++;
        (,,,,,,,,,, uint8 side,,,,,,,) = m.getClaim(id);
        for (uint256 i = 0; i < who.length; i++) {
            uint256 afterwards = who[i].balance + m.pendingWithdrawals(who[i]);
            if (afterwards < before[i]) {
                principalViolated = true;
                continue;
            }
            bool won = side == m.SIDE_CREATOR() ? i == 0
                : side == m.SIDE_CHALLENGERS() ? i > 0
                : true; // draw / unresolvable: everyone is refunded
            if (won && afterwards - before[i] < stake[i]) principalViolated = true;
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    function warp(uint256 secs) external {
        _advanceTo(t + (secs % 12 hours));
    }

    function create(uint256 who, uint256 stakeSeed, uint256 mode, bool withAgent) external {
        if (m.claimCount() >= MAX_CLAIMS) return;
        uint256 stake = m.MIN_STAKE() + (stakeSeed % (50 * ONE));
        bool fixedOdds = mode % 3 == 0;
        uint256 bps = fixedOdds ? 10_000 + (mode % 30_000) : 0;
        bytes memory call_ = abi.encodeWithSelector(
            MimirV3.createClaim.selector,
            "q", "yes", "no", "u", t + 1 days + (mode % 2 days), stake, "c", uint256(0), "binary",
            fixedOdds ? "fixed" : "pool", bps, "", "rule", uint256(0), false, "", withAgent ? agent : address(0)
        );
        vm.prank(_actor(who));
        (bool ok,) = address(m).call{value: stake}(call_);
        ok;
    }

    function challenge(uint256 idSeed, uint256 who, uint256 stakeSeed, bool withAgent) external {
        uint256 id = _find(idSeed, m.ST_OPEN(), m.ST_ACTIVE());
        if (id == 0) return;
        uint256 stake = m.MIN_STAKE() + (stakeSeed % (50 * ONE));
        vm.prank(_actor(who));
        (bool ok,) = address(m).call{value: stake}(abi.encodeWithSelector(
            MimirV3.challengeClaim.selector, id, stake, "", withAgent ? agent : address(0)
        ));
        ok;
    }

    function resolve(uint256 idSeed, uint8 sideSeed) external {
        uint256 id = _find(idSeed, m.ST_ACTIVE(), m.ST_ACTIVE());
        if (id == 0) return;
        _advanceTo(_deadline(id));
        uint8 side = 1 + (sideSeed % 4);
        (address[] memory who, uint256[] memory stake, uint256[] memory before) = _participants(id);
        vm.prank(oracle);
        (bool ok,) = address(m).call(abi.encodeWithSelector(
            MimirV3.resolveClaim.selector, id, side, "v", uint8(90), bytes32(0)
        ));
        // With a dispute window this only proposes; settled means window 0.
        if (ok && _state(id) == m.ST_RESOLVED()) _checkPrincipal(id, who, stake, before);
    }

    function dispute(uint256 idSeed, uint256 whoSeed) external {
        uint256 id = _find(idSeed, m.ST_PROPOSED(), m.ST_PROPOSED());
        if (id == 0) return;
        (address[] memory who,,) = _participants(id);
        uint256 bond = m.MIN_STAKE();
        vm.prank(who[whoSeed % who.length]);
        (bool ok,) = address(m).call{value: bond}(abi.encodeWithSelector(MimirV3.disputeResolution.selector, id));
        ok;
    }

    function finalize(uint256 idSeed) external {
        uint256 id = _find(idSeed, m.ST_PROPOSED(), m.ST_PROPOSED());
        if (id == 0) return;
        (,, uint64 proposedAt,,,,,) = m.proposals(id);
        _advanceTo(uint256(proposedAt) + window);
        (address[] memory who, uint256[] memory stake, uint256[] memory before) = _participants(id);
        (bool ok,) = address(m).call(abi.encodeWithSelector(MimirV3.finalizeResolution.selector, id));
        if (ok) _checkPrincipal(id, who, stake, before);
    }

    function arbitrate(uint256 idSeed, uint8 sideSeed) external {
        uint256 id = _find(idSeed, m.ST_DISPUTED(), m.ST_DISPUTED());
        if (id == 0) return;
        (address[] memory who, uint256[] memory stake, uint256[] memory before) = _participants(id);
        vm.prank(owner);
        (bool ok,) = address(m).call(abi.encodeWithSelector(
            MimirV3.resolveDispute.selector, id, uint8(1 + (sideSeed % 4)), "a", uint8(100), bytes32(0)
        ));
        if (ok) _checkPrincipal(id, who, stake, before);
    }

    function refund(uint256 idSeed) external {
        uint256 id = _find(idSeed, m.ST_ACTIVE(), m.ST_DISPUTED());
        if (id == 0) return;
        uint256 start = _deadline(id);
        (,,, uint64 disputedAt,,,,) = m.proposals(id);
        if (disputedAt > start) start = disputedAt;
        _advanceTo(start + m.RESOLUTION_GRACE_SECONDS());
        (address[] memory who, uint256[] memory stake, uint256[] memory before) = _participants(id);
        (bool ok,) = address(m).call(abi.encodeWithSelector(MimirV3.refundExpired.selector, id));
        if (ok) _checkPrincipal(id, who, stake, before);
    }

    function cancel(uint256 idSeed) external {
        uint256 id = _find(idSeed, m.ST_OPEN(), m.ST_OPEN());
        if (id == 0) return;
        (address creator,,,,,,,,,,,,,,,,,) = m.getClaim(id);
        vm.prank(creator);
        (bool ok,) = address(m).call(abi.encodeWithSelector(MimirV3.cancelClaim.selector, id));
        ok;
    }

    function withdraw(uint256 who) external {
        address a = _actor(who);
        if (m.pendingWithdrawals(a) == 0) return;
        vm.prank(a);
        (bool ok,) = address(m).call(abi.encodeWithSelector(MimirV3.withdraw.selector));
        ok;
    }

    function claimFees(bool agentSide) external {
        vm.prank(agentSide ? agent : platform);
        (bool ok,) = address(m).call(abi.encodeWithSelector(MimirV3.claimFees.selector));
        ok;
    }

    function toggleRefuser() external {
        refuser.toggle();
    }
}

contract MimirV3InvariantTest {
    /// Same shape as forge-std's StdInvariant.FuzzSelector; forge decodes it by ABI.
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    Handler handler;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address agent = address(0xA6E7);

    function setUp() public {
        vm.warp(1_000_000);
        // Real fees on both legs, and a dispute window, so every path moves money.
        mimir = new MimirV3(oracle, 500, 300, platform, address(0), 1 hours);
        mimir.setAgentPayout(agent, true);
        uint256 t = 1_000_000 + mimir.FEE_TIMELOCK_SECONDS();
        vm.warp(t);

        Refuser refuser = new Refuser();
        address[] memory actors = new address[](5);
        actors[0] = address(0xA11CE);
        actors[1] = address(0xB0B);
        actors[2] = address(0xCA201);
        actors[3] = address(0xDA7E);
        actors[4] = address(refuser);
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000_000 ether);
        }

        handler = new Handler(mimir, address(this), oracle, agent, platform, refuser, actors, t);
        vm.deal(address(handler), 1_000_000 ether);
    }

    /// Fuzz only the handler...
    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// ...and only its actions, not its getters.
    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        bytes4[] memory s = new bytes4[](12);
        s[0] = Handler.warp.selector;
        s[1] = Handler.create.selector;
        s[2] = Handler.challenge.selector;
        s[3] = Handler.resolve.selector;
        s[4] = Handler.dispute.selector;
        s[5] = Handler.finalize.selector;
        s[6] = Handler.arbitrate.selector;
        s[7] = Handler.refund.selector;
        s[8] = Handler.cancel.selector;
        s[9] = Handler.withdraw.selector;
        s[10] = Handler.claimFees.selector;
        s[11] = Handler.toggleRefuser.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector({addr: address(handler), selectors: s});
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_escrowCoversEverythingItOwes() public view {
        uint256 owed = mimir.accruedFees(platform) + mimir.accruedFees(agent);
        uint256 n = handler.actorCount();
        for (uint256 i = 0; i < n; i++) {
            owed += mimir.pendingWithdrawals(handler.actors(i));
        }
        uint256 claims = mimir.claimCount();
        for (uint256 id = 1; id <= claims; id++) {
            (,,,,, uint256 cs, uint256 tcs,,, uint8 state,,,,,,,,) = mimir.getClaim(id);
            if (state == mimir.ST_RESOLVED() || state == mimir.ST_CANCELLED()) continue;
            owed += cs + tcs;
            if (state == mimir.ST_DISPUTED()) {
                (,,,,, uint256 bond,,) = mimir.proposals(id);
                owed += bond;
            }
        }
        assert(address(mimir).balance >= owed);
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_feeBooksBalance() public view {
        assert(
            mimir.lifetimeFeesAccrued() - mimir.lifetimeFeesClaimed()
                == mimir.accruedFees(platform) + mimir.accruedFees(agent)
        );
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_noWinnerGetsBackLessThanTheirStake() public view {
        assert(!handler.principalViolated());
    }
}
