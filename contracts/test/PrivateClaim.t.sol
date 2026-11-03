// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MimirV3, IMimirFees as IVsFees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";
import {FlatFees} from "./FlatFees.sol";
import {MiniAccount} from "./MimirV3SmartAccount.t.sol";

interface VmPrivateClaim {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

contract PrivateClaimTest {
    VmPrivateClaim constant vm = VmPrivateClaim(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 1 days;
    uint256 constant PROPOSED = DEADLINE + 1;
    uint256 constant STAKE = 10e18;
    address constant CREATOR = address(0xC0);
    address constant ALICE = address(0xA1);
    address constant BOB = address(0xB0);
    address constant ORACLE = address(0x0123);
    MimirV3 vs;
    MimirPool pool;

    function setUp() public {
        vm.warp(T0);
        address fees = address(new FlatFees(0));
        vs = new MimirV3(address(this), address(this), ORACLE, address(0xFEE), IVsFees(fees), 1 days, 1e16);
        pool = new MimirPool(address(this), address(this), ORACLE, address(0xFEE), IPoolFees(fees), 1 days, 1e16);
        vm.deal(CREATOR, 1_000e18);
        vm.deal(ALICE, 1_000e18);
        vm.deal(BOB, 1_000e18);
    }

    function _create(bool restricted, string memory mode, uint256 slots, string memory key) internal returns (uint256) {
        vm.prank(CREATOR);
        return vs.createClaim{value: STAKE}("Q?", "Yes", "No", "https://example.com", DEADLINE, STAKE,
            "custom", 0, "binary", mode, 20_000, "", "", slots, restricted, key, address(0));
    }

    function _challenge(address who, uint256 id, string memory key) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(vs).call{value: STAKE}(abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, STAKE, key, address(0)));
    }

    function _invited(uint256 id, address who) internal view returns (bool) {
        (bool ok, bytes memory data) = address(vs).staticcall(abi.encodeWithSignature("invited(uint256,address)", id, who));
        return ok && data.length == 32 && abi.decode(data, (bool));
    }

    function _grant(address caller, uint256 id, address who, bool allowed) internal returns (bool ok) {
        address[] memory accounts = new address[](1);
        accounts[0] = who;
        vm.prank(caller);
        (ok,) = address(vs).call(abi.encodeWithSignature("setInvited(uint256,address[],bool)", id, accounts, allowed));
    }

    function test_copiedCreationKeyCannotConsumeFixedLiquidityOrSlot() public {
        uint256 id = _create(true, "fixed", 1, "public-key");
        require(!_challenge(BOB, id, "public-key"), "copied creation key admitted stranger");
        require(BOB.balance == 1_000e18 && !vs.hasChallenged(id, BOB));
        (,,,,,,, uint256 reserved,,,,,,,,,,) = vs.getClaim(id);
        require(reserved == 0);
        require(_grant(CREATOR, id, ALICE, true));
        require(_challenge(ALICE, id, "anything"));
        (address joined, uint256 stake) = vs.getChallenger(id, 0);
        require(joined == ALICE && stake == STAKE);
    }

    function test_walletGrantsAreCreatorOnlyAndRevocationPreservesFundedPosition() public {
        uint256 id = _create(true, "pool", 3, "");
        require(!_grant(BOB, id, BOB, true));
        require(!_grant(address(this), id, BOB, true));
        require(!_challenge(BOB, id, ""));
        require(_grant(CREATOR, id, ALICE, true));
        require(_grant(CREATOR, id, BOB, true));
        require(_challenge(ALICE, id, "public challenge calldata"));
        require(_grant(CREATOR, id, ALICE, false));
        require(_grant(CREATOR, id, BOB, false));
        require(!_challenge(BOB, id, "public challenge calldata"));
        vm.warp(PROPOSED);
        vm.prank(ORACLE);
        vs.resolveClaim(id, 2, "challengers win", 95, bytes32(0));
        vm.warp(PROPOSED + 1 days);
        vs.finalizeResolution(id);
        require(ALICE.balance == 1_010e18); // a grant is entry authority, never payout authority
    }

    function test_invitesArePerClaimAndRematchesStartClosed() public {
        uint256 parent = _create(true, "pool", 3, "same-key");
        uint256 other = _create(true, "pool", 3, "same-key");
        require(_grant(CREATOR, parent, ALICE, true));
        require(!_challenge(ALICE, other, "same-key"));
        vm.prank(CREATOR);
        uint256 rematch = vs.createRematch{value: STAKE}(parent, DEADLINE, STAKE, "same-key");
        require(!_invited(rematch, ALICE));
        require(!_challenge(ALICE, rematch, "same-key"));
        require(_grant(CREATOR, rematch, BOB, true));
        require(_challenge(BOB, rematch, ""));
        require(_invited(parent, ALICE) && !_invited(parent, BOB));
    }

    function test_invalidInviteBatchesAreAtomicAndClosedOrPublicClaimsRejectChanges() public {
        uint256 id = _create(true, "pool", 3, "");
        address[] memory accounts = new address[](2);
        accounts[0] = ALICE;
        accounts[1] = address(0);
        vm.prank(CREATOR);
        (bool zero,) = address(vs).call(abi.encodeWithSignature("setInvited(uint256,address[],bool)", id, accounts, true));
        require(!zero && !_invited(id, ALICE));
        accounts[1] = CREATOR;
        vm.prank(CREATOR);
        (bool self,) = address(vs).call(abi.encodeWithSignature("setInvited(uint256,address[],bool)", id, accounts, true));
        require(!self && !_invited(id, ALICE));
        accounts = new address[](101);
        for (uint256 i; i < accounts.length; i++) accounts[i] = ALICE;
        vm.prank(CREATOR);
        (bool oversized,) = address(vs).call(abi.encodeWithSignature("setInvited(uint256,address[],bool)", id, accounts, true));
        require(!oversized);
        vm.prank(CREATOR);
        vs.cancelClaim(id);
        require(!_grant(CREATOR, id, ALICE, true));
        uint256 publicId = _create(false, "pool", 3, "");
        require(!_grant(CREATOR, publicId, ALICE, true));
    }

    function testFuzz_uninvitedWalletCannotReplayPublicKey(address outsider) public {
        if (outsider == address(0) || outsider == CREATOR || outsider == ALICE) return;
        vm.deal(outsider, 1_000e18);
        uint256 id = _create(true, "pool", 3, "public-key");
        require(_grant(CREATOR, id, ALICE, true));
        require(!_challenge(outsider, id, "public-key"));
        require(!vs.hasChallenged(id, outsider));
    }

    function test_smartAccountNeedsItsOwnGrantNotItsOwnersGrant() public {
        uint256 id = _create(true, "pool", 3, "");
        MiniAccount account = new MiniAccount(ALICE);
        vm.deal(address(account), 1_000e18);
        require(_grant(CREATOR, id, ALICE, true));
        bytes memory join = abi.encodeCall(MimirV3.challengeClaim, (id, STAKE, "copied", address(0)));
        vm.prank(ALICE);
        (bool ownerOnly,) = address(account).call(abi.encodeCall(MiniAccount.execute, (address(vs), STAKE, join)));
        require(!ownerOnly);
        require(_grant(CREATOR, id, ALICE, false));
        require(_grant(CREATOR, id, address(account), true));
        require(!_challenge(ALICE, id, "copied"));
        vm.prank(ALICE);
        account.execute(address(vs), STAKE, join);
        require(vs.hasChallenged(id, address(account)) && !vs.hasChallenged(id, ALICE));
    }

}
