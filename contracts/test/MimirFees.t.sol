// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirFees} from "../MimirFees.sol";
import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";

/**
 * The holder discount: a ticket signed by Mimir's server lowers one account's
 * entry fee until it expires. Dependency-free like the rest of the suite.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

contract MimirFeesTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirFees fees;
    uint256 constant SIGNER_KEY = 0x5161;
    uint256 constant OTHER_KEY = 0xBAD;
    address signer;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant T0 = 1_000_000;
    uint256 constant ONE = 1e18;

    function setUp() public {
        vm.warp(T0);
        signer = vm.addr(SIGNER_KEY);
        fees = new MimirFees(signer);
    }

    function _sig(uint256 key, address account, uint8 tier, uint64 expires) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, fees.ticketDigest(account, tier, expires));
        return abi.encodePacked(r, s, v);
    }

    function _apply(address account, uint8 tier, uint64 expires, bytes memory sig) internal returns (bool ok, bytes memory ret) {
        vm.prank(account);
        (ok, ret) = address(fees).call(abi.encodeWithSelector(MimirFees.applyTicket.selector, tier, expires, sig));
    }

    function _err(bytes4 sel) internal pure returns (bytes32) {
        return keccak256(abi.encodeWithSelector(sel));
    }

    // ── Rates ───────────────────────────────────────────────────────────────

    function test_everyoneStartsAtTheBaseRate() public view {
        assert(fees.entryBps(alice) == 50);
    }

    function test_eachTierGetsItsRate() public {
        uint64 exp = uint64(T0 + 1 days);
        (bool h,) = _apply(alice, 1, exp, _sig(SIGNER_KEY, alice, 1, exp));
        (bool w,) = _apply(bob, 2, exp, _sig(SIGNER_KEY, bob, 2, exp));
        assert(h && w);
        assert(fees.entryBps(alice) == 25);
        assert(fees.entryBps(bob) == 10);
    }

    function test_anExpiredTicketFallsBackToTheBaseRate() public {
        uint64 exp = uint64(T0 + 1 days);
        _apply(alice, 2, exp, _sig(SIGNER_KEY, alice, 2, exp));
        vm.warp(T0 + 1 days - 1);
        assert(fees.entryBps(alice) == 10);
        vm.warp(T0 + 1 days);
        assert(fees.entryBps(alice) == 50);
    }

    // ── Refusals ────────────────────────────────────────────────────────────

    function test_aTicketFromAnotherKeyIsRefused() public {
        uint64 exp = uint64(T0 + 1 days);
        (bool ok, bytes memory r) = _apply(alice, 2, exp, _sig(OTHER_KEY, alice, 2, exp));
        assert(!ok && keccak256(r) == _err(MimirFees.BadSignature.selector));
    }

    function test_aTicketCannotBeUsedByAnotherAccount() public {
        uint64 exp = uint64(T0 + 1 days);
        bytes memory alices = _sig(SIGNER_KEY, alice, 2, exp);
        (bool ok, bytes memory r) = _apply(bob, 2, exp, alices);
        assert(!ok && keccak256(r) == _err(MimirFees.BadSignature.selector));
        assert(fees.entryBps(bob) == 50);
    }

    function test_aTicketCannotBeUpgraded() public {
        uint64 exp = uint64(T0 + 1 days);
        (bool ok,) = _apply(alice, 2, exp, _sig(SIGNER_KEY, alice, 1, exp));
        assert(!ok);
    }

    function test_badTiersAndExpiriesAreRefused() public {
        uint64 exp = uint64(T0 + 1 days);
        (bool tier, bytes memory r1) = _apply(alice, 3, exp, _sig(SIGNER_KEY, alice, 3, exp));
        assert(!tier && keccak256(r1) == _err(MimirFees.BadTier.selector));

        uint64 tooLong = uint64(T0 + fees.MAX_TICKET_SECONDS() + 1);
        (bool long, bytes memory r2) = _apply(alice, 2, tooLong, _sig(SIGNER_KEY, alice, 2, tooLong));
        assert(!long && keccak256(r2) == _err(MimirFees.BadExpiry.selector));

        uint64 past = uint64(T0);
        (bool stale, bytes memory r3) = _apply(alice, 2, past, _sig(SIGNER_KEY, alice, 2, past));
        assert(!stale && keccak256(r3) == _err(MimirFees.BadExpiry.selector));
    }

    function test_aMalformedSignatureIsRefused() public {
        uint64 exp = uint64(T0 + 1 days);
        bytes memory sig = _sig(SIGNER_KEY, alice, 2, exp);
        // The malleable twin (s -> n - s, v flipped) recovers the same signer: refused by the low-s rule.
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory twin = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        (bool high,) = _apply(alice, 2, exp, twin);
        (bool short,) = _apply(alice, 2, exp, hex"1234");
        assert(!high && !short);
    }

    // ── Signer rotation and ownership ───────────────────────────────────────

    function test_rotatingTheSignerRetiresItsTickets() public {
        uint64 exp = uint64(T0 + 1 days);
        bytes memory old = _sig(SIGNER_KEY, alice, 2, exp);
        address next = vm.addr(OTHER_KEY);
        fees.setSigner(next);
        (bool stale,) = _apply(alice, 2, exp, old);
        (bool fresh,) = _apply(alice, 2, exp, _sig(OTHER_KEY, alice, 2, exp));
        assert(!stale && fresh);
    }

    function test_onlyTheOwnerSetsTheSigner() public {
        vm.prank(alice);
        (bool ok,) = address(fees).call(abi.encodeWithSelector(MimirFees.setSigner.selector, alice));
        assert(!ok);
    }

    function test_ownershipIsTwoStepAndTimelocked() public {
        fees.transferOwnership(alice);
        vm.prank(alice);
        (bool early,) = address(fees).call(abi.encodeWithSelector(MimirFees.acceptOwnership.selector));
        assert(!early);
        vm.warp(T0 + fees.OWNERSHIP_TIMELOCK_SECONDS());
        vm.prank(alice);
        fees.acceptOwnership();
        assert(fees.owner() == alice);
    }

    // ── The discount reaches both markets ───────────────────────────────────

    function test_aWhaleTicketLowersTheEntryFeeOnBothMarkets() public {
        address platform = address(0xFEE);
        MimirV3 v3 = new MimirV3(address(0x0417ac1e), platform, IMimirFees(address(fees)), 0, 2e18);
        MimirPool pool = new MimirPool(address(0x0417ac1e), platform, IPoolFees(address(fees)), 0, 2e18);
        uint64 exp = uint64(T0 + 1 days);
        _apply(alice, 2, exp, _sig(SIGNER_KEY, alice, 2, exp));
        vm.deal(alice, 100 * ONE);

        vm.prank(alice);
        v3.createClaim{value: 10 * ONE}(
            "q", "yes", "no", "u", T0 + 1 days, 10 * ONE, "c", 0, "binary", "pool", 0, "", "", 0, false, "", address(0)
        );
        assert(v3.accruedFees(platform) == (10 * ONE * 10) / 10_000);

        vm.prank(alice);
        pool.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", T0 + 1 days, 1, address(0));
        assert(pool.accruedFees(platform) == (10 * ONE * 10) / 10_000);

        // Bob has no ticket: the base 0.5%.
        vm.deal(bob, 100 * ONE);
        vm.prank(bob);
        pool.stake{value: 10 * ONE}(1, 2, address(0));
        assert(pool.accruedFees(platform) == (10 * ONE * 10) / 10_000 + (10 * ONE * 50) / 10_000);
    }
}
