// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirPool, IMimirFees} from "../MimirPool.sol";
import {MimirFees} from "../MimirFees.sol";

/**
 * MimirPool invariants over random create / stake / resolve / dispute /
 * finalize / arbitrate / refund / claim / withdraw / claimFees and the clock:
 *
 *   1. The contract's balance covers every unclaimed obligation: stakes and
 *      bonds of unsettled markets, what every staker of a settled market can
 *      still claim (fee included), parked payouts and accrued fees.
 *   2. No market ever pays out (payouts + fees) more than its pot.
 *   3. No winner (or refunded staker) gets back less than their stake.
 *   4. The fee books agree with the open fee balances (platform and referrer).
 *   5. A claim's fee is only ever the copy-trade share of profit (at most
 *      2%): never charged on a stake.
 *
 * Fees in play: the real 0.5% entry fee on every stake, and random referrers.
 *
 * Dependency-free: forge reads targetContracts()/targetSelectors() by selector.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

contract PoolRefuser {
    bool public refuse;

    function toggle() external {
        refuse = !refuse;
    }

    receive() external payable {
        if (refuse) revert("refused");
    }
}

contract PoolHandler {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant ONE = 1e18;
    uint256 constant MAX_MARKETS = 16;
    /// The basket creator named on copy stakes.
    address public constant REF = address(0x5EF);

    MimirPool public immutable pool;
    address public immutable owner;
    address public immutable oracle;
    address public immutable platform;
    PoolRefuser public immutable refuser;

    address[] public actors;
    uint256 public t;
    bool public principalViolated;
    bool public feeOnPrincipal;
    uint256 public claims;
    /// Gross paid out per market (payouts + fees taken from them).
    mapping(uint256 => uint256) public grossPaid;

    constructor(MimirPool _pool, address _owner, address _oracle, address _platform, PoolRefuser _refuser, address[] memory _actors, uint256 _t) {
        pool = _pool;
        owner = _owner;
        oracle = _oracle;
        platform = _platform;
        refuser = _refuser;
        actors = _actors;
        t = _t;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,, state,,,) = pool.getMarket(id);
    }

    function _find(uint256 s, uint8 a, uint8 b) internal view returns (uint256) {
        uint256 n = pool.marketCount();
        for (uint256 k = 0; k < n; k++) {
            uint256 id = 1 + ((s % n + k) % n);
            uint8 st = _state(id);
            if (st == a || st == b) return id;
        }
        return 0;
    }

    function _advanceTo(uint256 when) internal {
        if (t < when) {
            t = when;
            vm.warp(t);
        }
    }

    function _deadline(uint256 id) internal view returns (uint256 d) {
        (, d,,,,,) = pool.getMarket(id);
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    function warp(uint256 secs) external {
        _advanceTo(t + (secs % 12 hours));
    }

    function create(uint256 who, uint256 amount, uint256 mode) external {
        if (pool.marketCount() >= MAX_MARKETS) return;
        uint256 value = 2 * ONE + (amount % (100 * ONE));
        uint8 side = uint8(1 + (mode % 2));
        uint256 deadline = t + 1 hours + (mode % 2 days);
        vm.prank(_actor(who));
        (bool ok,) = address(pool).call{value: value}(abi.encodeWithSelector(
            MimirPool.createMarket.selector, "q", "Y", "N", "u", "c", deadline, side, mode % 3 == 0 ? REF : address(0)
        ));
        ok;
    }

    function stake(uint256 idSeed, uint256 who, uint256 amount, bool onA) external {
        uint256 id = _find(idSeed, pool.ST_OPEN(), pool.ST_OPEN());
        if (id == 0) return;
        uint256 value = 2 * ONE + (amount % (100 * ONE));
        vm.prank(_actor(who));
        (bool ok,) = address(pool).call{value: value}(
            abi.encodeWithSelector(MimirPool.stake.selector, id, onA ? uint8(1) : uint8(2), amount % 2 == 0 ? REF : address(0))
        );
        ok;
    }

    function resolve(uint256 idSeed, uint8 outcomeSeed) external {
        uint256 id = _find(idSeed, pool.ST_OPEN(), pool.ST_OPEN());
        if (id == 0) return;
        _advanceTo(_deadline(id));
        vm.prank(oracle);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(
            MimirPool.resolve.selector, id, uint8(1 + (outcomeSeed % 4)), "v", bytes32(0)
        ));
        ok;
    }

    function dispute(uint256 idSeed, uint256 whoSeed) external {
        uint256 id = _find(idSeed, pool.ST_PROPOSED(), pool.ST_PROPOSED());
        if (id == 0) return;
        for (uint256 k = 0; k < actors.length; k++) {
            address a = actors[(whoSeed % actors.length + k) % actors.length];
            (uint256 onA, uint256 onB) = pool.stakeOf(id, a);
            if (onA + onB == 0) continue;
            vm.prank(a);
            (bool ok,) = address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.dispute.selector, id));
            ok;
            return;
        }
    }

    function finalize(uint256 idSeed) external {
        uint256 id = _find(idSeed, pool.ST_PROPOSED(), pool.ST_PROPOSED());
        if (id == 0) return;
        (, uint256 proposedAt,,,,) = pool.getProposal(id);
        _advanceTo(proposedAt + pool.disputeWindow());
        (bool ok,) = address(pool).call(abi.encodeWithSelector(MimirPool.finalize.selector, id));
        ok;
    }

    function arbitrate(uint256 idSeed, uint8 outcomeSeed) external {
        uint256 id = _find(idSeed, pool.ST_DISPUTED(), pool.ST_DISPUTED());
        if (id == 0) return;
        vm.prank(owner);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(
            MimirPool.resolveDispute.selector, id, uint8(1 + (outcomeSeed % 4)), "a", bytes32(0)
        ));
        ok;
    }

    function refund(uint256 idSeed) external {
        uint256 id = _find(idSeed, pool.ST_OPEN(), pool.ST_DISPUTED());
        if (id == 0) return;
        uint256 start = _deadline(id);
        (,, uint256 disputedAt,,,) = pool.getProposal(id);
        if (disputedAt > start) start = disputedAt;
        _advanceTo(start + pool.RESOLUTION_GRACE_SECONDS());
        (bool ok,) = address(pool).call(abi.encodeWithSelector(MimirPool.refundExpired.selector, id));
        ok;
    }

    /// Claim for the first actor (from a random start) who is owed something.
    function claim(uint256 idSeed, uint256 whoSeed) external {
        uint256 id = _find(idSeed, pool.ST_RESOLVED(), pool.ST_RESOLVED());
        if (id == 0) return;
        for (uint256 k = 0; k < actors.length; k++) {
            address a = actors[(whoSeed % actors.length + k) % actors.length];
            (uint256 payout, uint256 fee) = pool.claimable(id, a);
            if (payout + fee == 0) continue;
            _claimAndCheck(id, a, payout, fee);
            return;
        }
    }

    function _claimAndCheck(uint256 id, address a, uint256 payout, uint256 fee) internal {
        uint256 before = a.balance + pool.pendingWithdrawals(a);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(MimirPool.claimFor.selector, id, a));
        if (!ok) return;
        claims++;
        grossPaid[id] += payout + fee;
        uint256 afterwards = a.balance + pool.pendingWithdrawals(a);
        if (afterwards < before || afterwards - before != payout) {
            principalViolated = true;
            return;
        }
        // At least the stake that earned the payout: the winning leg, or both legs on a refund.
        (,,,, uint8 outcome, uint256 totalA, uint256 totalB) = pool.getMarket(id);
        (uint256 onA, uint256 onB) = pool.stakeOf(id, a);
        bool contested = totalA != 0 && totalB != 0;
        uint256 floor = contested && outcome == 1 ? onA : contested && outcome == 2 ? onB : onA + onB;
        if (payout < floor) {
            principalViolated = true;
            return;
        }
        // payout + fee - floor is the profit; the fee may be at most the copy-trade share of it.
        uint256 maxBps = uint256(pool.REFERRER_FEE_BPS()) + pool.COPY_FEE_BPS();
        if (fee * 10_000 > (payout + fee - floor) * maxBps) feeOnPrincipal = true;
    }

    function withdraw(uint256 who) external {
        address a = _actor(who);
        if (pool.pendingWithdrawals(a) == 0) return;
        vm.prank(a);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(MimirPool.withdraw.selector));
        ok;
    }

    function claimFees() external {
        vm.prank(platform);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(MimirPool.claimFees.selector));
        ok;
    }

    function toggleRefuser() external {
        refuser.toggle();
    }
}

contract MimirPoolInvariantTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    MimirPool pool;
    PoolHandler handler;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);

    function setUp() public {
        uint256 t = 1_000_000;
        vm.warp(t);
        pool = new MimirPool(address(this), address(this), oracle, platform, IMimirFees(address(new MimirFees(address(this), address(0x5161)))), 1 hours, 2e18);

        PoolRefuser refuser = new PoolRefuser();
        address[] memory actors = new address[](5);
        actors[0] = address(0xA11CE);
        actors[1] = address(0xB0B);
        actors[2] = address(0xCA201);
        actors[3] = address(0xDA7E);
        actors[4] = address(refuser);
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000_000 ether);
        }
        handler = new PoolHandler(pool, address(this), oracle, platform, refuser, actors, t);
        vm.deal(address(handler), 1_000_000 ether);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        bytes4[] memory s = new bytes4[](13);
        s[0] = PoolHandler.warp.selector;
        s[1] = PoolHandler.create.selector;
        s[2] = PoolHandler.stake.selector;
        s[3] = PoolHandler.resolve.selector;
        s[4] = PoolHandler.dispute.selector;
        s[5] = PoolHandler.finalize.selector;
        s[6] = PoolHandler.arbitrate.selector;
        s[7] = PoolHandler.refund.selector;
        s[8] = PoolHandler.claim.selector;
        s[9] = PoolHandler.claim.selector; // claims weighted up: they are where money leaves
        s[10] = PoolHandler.withdraw.selector;
        s[11] = PoolHandler.claimFees.selector;
        s[12] = PoolHandler.toggleRefuser.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector({addr: address(handler), selectors: s});
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_balanceCoversEveryObligation() public view {
        uint256 owed = pool.accruedFees(platform) + pool.accruedFees(handler.REF());
        uint256 n = handler.actorCount();
        for (uint256 i = 0; i < n; i++) {
            owed += pool.pendingWithdrawals(handler.actors(i));
        }
        uint256 markets = pool.marketCount();
        for (uint256 id = 1; id <= markets; id++) {
            (,,, uint8 state,, uint256 totalA, uint256 totalB) = pool.getMarket(id);
            if (state != pool.ST_RESOLVED()) {
                (,,,, uint256 bond,) = pool.getProposal(id);
                owed += totalA + totalB + bond;
            } else {
                for (uint256 i = 0; i < n; i++) {
                    (uint256 payout, uint256 fee) = pool.claimable(id, handler.actors(i));
                    owed += payout + fee;
                }
            }
        }
        assert(address(pool).balance >= owed);
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_noMarketPaysMoreThanItsPot() public view {
        uint256 markets = pool.marketCount();
        for (uint256 id = 1; id <= markets; id++) {
            (,,,,, uint256 totalA, uint256 totalB) = pool.getMarket(id);
            assert(handler.grossPaid(id) <= totalA + totalB);
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_noWinnerBelowTheirStake() public view {
        assert(!handler.principalViolated());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_feeOnlyOnProfit() public view {
        assert(!handler.feeOnPrincipal());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 200
    function invariant_feeBooksBalance() public view {
        assert(
            pool.lifetimeFeesAccrued() - pool.lifetimeFeesClaimed()
                == pool.accruedFees(platform) + pool.accruedFees(handler.REF())
        );
    }
}
