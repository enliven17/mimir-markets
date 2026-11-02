// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirPoolErc20, IMimirFees, IUsdc} from "../MimirPoolErc20.sol";
import {MimirFees} from "../MimirFees.sol";
import {MimirV3Erc20, IMimirFees as V3Fees, IUsdc as V3Usdc} from "../MimirV3Erc20.sol";

interface ForkVm {
    function envOr(string calldata, string calldata) external returns (string memory);
    function createSelectFork(string calldata) external returns (uint256);
    function skip(bool) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function warp(uint256) external;
}
interface FiatToken {
    function masterMinter() external view returns (address);
    function configureMinter(address, uint256) external returns (bool);
    function mint(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
interface SafeFactory {
    function createProxyWithNonce(address, bytes calldata, uint256) external returns (address);
}
interface Safe {
    function setup(address[] calldata, uint256, address, bytes calldata, address, address, uint256, address) external;
    function nonce() external view returns (uint256);
    function getTransactionHash(address, uint256, bytes calldata, uint8, uint256, uint256, uint256, address, address, uint256) external view returns (bytes32);
    function execTransaction(address, uint256, bytes calldata, uint8, uint256, uint256, uint256, address, address, bytes calldata) external payable returns (bool);
}

/** Fork only: uses canonical Base Safe and real USDC proxy/permit. Sends no live transactions. */
contract BaseMainnetForkTest {
    ForkVm constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FiatToken constant usdc = FiatToken(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    Safe safe;
    MimirPoolErc20 pool;
    address oracle;
    address alice;
    address bob;
    uint256 deadline;
    uint256 constant OWNER1 = uint256(keccak256("mimir.fork.safe.owner1"));
    uint256 constant OWNER2 = uint256(keccak256("mimir.fork.safe.owner2"));
    uint256 constant BOB_KEY = uint256(keccak256("mimir.fork.permit.bob"));

    function setUp() public {
        string memory rpc = vm.envOr("BASE_MAINNET_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc);
        require(block.chainid == 8453, "Base mainnet fork only");
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(OWNER1); owners[1] = vm.addr(OWNER2); owners[2] = vm.addr(uint256(keccak256("mimir.fork.safe.owner3")));
        bytes memory setup = abi.encodeCall(Safe.setup, (owners, 2, address(0), bytes(""), address(0), address(0), 0, address(0)));
        safe = Safe(SafeFactory(0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67).createProxyWithNonce(0x29fcB43b46531BcA003ddC8FCB67FFE91900C762, setup, 8453));
        oracle = vm.addr(104); alice = vm.addr(uint256(keccak256("mimir.fork.alice"))); bob = vm.addr(BOB_KEY);
        MimirFees fees = new MimirFees(address(safe), vm.addr(105));
        pool = new MimirPoolErc20(address(safe), address(safe), oracle, address(safe), IMimirFees(address(fees)), 1 days, 100_000, IUsdc(address(usdc)));
        vm.prank(usdc.masterMinter());
        require(usdc.configureMinter(address(this), 100e6));
        require(usdc.mint(alice, 10e6)); require(usdc.mint(bob, 10e6));
        deadline = block.timestamp + 1 days;
    }

    function _sig(uint256 key, bytes32 hash) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, hash);
        return abi.encodePacked(r, s, v);
    }
    function _safeCall(bytes memory data, bool two) internal returns (bool) {
        bytes32 hash = safe.getTransactionHash(address(pool), 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        bytes memory sigs = _sig(OWNER1, hash);
        if (two) sigs = vm.addr(OWNER1) < vm.addr(OWNER2) ? bytes.concat(sigs, _sig(OWNER2, hash)) : bytes.concat(_sig(OWNER2, hash), sigs);
        return safe.execTransaction(address(pool), 0, data, 0, 0, 0, 0, address(0), address(0), sigs);
    }

    function test_twoOfThreeSafeCapsAndPause() public {
        bytes memory caps = abi.encodeCall(MimirPoolErc20.setCaps, (500e6, 50e6));
        (bool single,) = address(this).call(abi.encodeCall(this.oneSignature, (caps)));
        require(!single, "one signature must fail");
        require(_safeCall(caps, true));
        require(pool.maxMarketStake() == 500e6 && pool.maxAccountStake() == 50e6);
        require(_safeCall(abi.encodeCall(MimirPoolErc20.setPaused, (true)), true)); require(pool.paused());
        require(_safeCall(abi.encodeCall(MimirPoolErc20.setPaused, (false)), true)); require(!pool.paused());
    }
    function oneSignature(bytes calldata data) external { _safeCall(data, false); }

    function test_realUsdcPermitResolveAndPayout() public {
        vm.prank(alice); require(usdc.approve(address(pool), 1e6));
        vm.prank(alice);
        uint256 id = pool.createMarket("Fork test", "Yes", "No", "https://example.com", "custom", deadline, 1, address(0), 1e6);
        bytes32 permit = keccak256(abi.encode(keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"), bob, address(pool), 1e6, usdc.nonces(bob), deadline));
        bytes32 hash = keccak256(abi.encodePacked(hex"1901", usdc.DOMAIN_SEPARATOR(), permit));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BOB_KEY, hash);
        vm.prank(bob); pool.stakeWithPermit(id, 2, address(0), 1e6, deadline, v, r, s);
        require(usdc.nonces(bob) == 1);
        vm.warp(deadline + 1);
        vm.prank(oracle); pool.resolve(id, 2, "fork result", bytes32(uint256(1)));
        vm.warp(deadline + 1 days + 1); pool.finalize(id);
        uint256 before = usdc.balanceOf(bob);
        pool.claimFor(id, bob);
        require(usdc.balanceOf(bob) > before, "winner paid in real USDC");
    }

    function test_realUsdcDisputeBondAndSafeRuling() public {
        vm.prank(alice); require(usdc.approve(address(pool), 1e6));
        vm.prank(alice);
        uint256 id = pool.createMarket("Fork dispute", "Yes", "No", "https://example.com", "custom", deadline, 1, address(0), 1e6);
        vm.prank(bob); require(usdc.approve(address(pool), 3e6));
        vm.prank(bob); pool.stake(id, 2, address(0), 1e6);
        vm.warp(deadline + 1);
        vm.prank(oracle); pool.resolve(id, 1, "proposal", bytes32(uint256(1)));
        vm.prank(bob); pool.dispute(id);
        require(usdc.balanceOf(bob) == 7e6, "2 USDC bond escrowed");
        require(_safeCall(abi.encodeCall(MimirPoolErc20.resolveDispute, (id, 2, "Safe ruling", bytes32(uint256(2)))), true));
        pool.claimFor(id, bob);
        require(usdc.balanceOf(bob) > 10e6, "bond returned and winning stake paid");
    }

    function test_realUsdcVsSettlement() public {
        MimirFees fees = new MimirFees(address(safe), vm.addr(105));
        MimirV3Erc20 vsMarket = new MimirV3Erc20(address(safe), address(safe), oracle, address(safe), V3Fees(address(fees)), 1 days, 100_000, V3Usdc(address(usdc)));
        vm.prank(alice); require(usdc.approve(address(vsMarket), 1e6));
        vm.prank(alice);
        uint256 id = vsMarket.createClaim("Fork VS", "Yes", "No", "https://example.com", deadline, 1e6, "custom", 0, "binary", "pool", 0, "", "Resolve from the source", 0, false, "", address(0));
        vm.prank(bob); require(usdc.approve(address(vsMarket), 1e6));
        vm.prank(bob); vsMarket.challengeClaim(id, 1e6, "", address(0));
        vm.warp(deadline + 1);
        vm.prank(oracle); vsMarket.resolveClaim(id, 2, "fork result", 90, bytes32(uint256(1)));
        uint256 before = usdc.balanceOf(bob);
        vm.warp(deadline + 1 days + 1); vsMarket.finalizeResolution(id);
        require(usdc.balanceOf(bob) > before, "VS winner paid in real USDC");
    }

    function _vsPosition(bool isPrivate) internal returns (MimirV3Erc20 vsMarket, uint256 id) {
        MimirFees fees = new MimirFees(address(safe), vm.addr(105));
        vsMarket = new MimirV3Erc20(address(safe), address(safe), oracle, address(safe), V3Fees(address(fees)), 1 days, 100_000, V3Usdc(address(usdc)));
        require(address(vsMarket).code.length <= 24_576, "Base runtime exceeds EIP-170");
        vm.prank(alice); require(usdc.approve(address(vsMarket), 1e6));
        vm.prank(alice);
        id = vsMarket.createClaim("Fork private VS", "Yes", "No", "u", deadline, 1e6, "custom", 0, "binary", "fixed", 20_000, "", "", 3, isPrivate, "visible-key", address(0));
        vm.prank(bob); require(usdc.approve(address(vsMarket), 1e6));
    }

    function test_realUsdcPrivateVsRejectsCopiedCalldata() public {
        (MimirV3Erc20 vsMarket, uint256 id) = _vsPosition(true);
        bytes memory data = abi.encodeCall(MimirV3Erc20.challengeClaim, (id, 1e6, "visible-key", address(0)));
        vm.prank(bob);
        (bool copied, bytes memory reason) = address(vsMarket).call(data);
        require(!copied && keccak256(reason) == keccak256(abi.encodeWithSelector(MimirV3Erc20.NotInvited.selector)));
        require(usdc.balanceOf(bob) == 10e6, "unauthorized wallet was charged");
        address[] memory accounts = new address[](1);
        accounts[0] = bob;
        vm.prank(alice); vsMarket.setInvited(id, accounts, true);
        vm.prank(bob);
        (bool invited,) = address(vsMarket).call(data);
        require(invited, "invited wallet could not join");
    }

    function test_realUsdcPausedVsProposalRefundsWithoutDispute() public {
        (MimirV3Erc20 vsMarket, uint256 id) = _vsPosition(false);
        vm.prank(bob); vsMarket.challengeClaim(id, 1e6, "", address(0));
        vm.warp(deadline + 1);
        vm.prank(oracle); vsMarket.resolveClaim(id, 1, "proposed", 90, bytes32(0));
        vm.prank(address(safe)); vsMarket.setPaused(true);
        vm.warp(deadline + 1 + 7 days);
        vsMarket.refundExpired(id);
        require(usdc.balanceOf(alice) == 10e6 - 5_000 && usdc.balanceOf(bob) == 10e6 - 5_000, "net stakes not refunded");
        require(vsMarket.accruedFees(address(safe)) == 10_000, "entry fees changed on refund");
    }

    function test_realUsdcPausedPoolProposalRefundsWithoutDispute() public {
        vm.prank(alice); require(usdc.approve(address(pool), 1e6));
        vm.prank(alice); uint256 id = pool.createMarket("Fork paused pool", "Yes", "No", "u", "custom", deadline, 1, address(0), 1e6);
        vm.prank(bob); require(usdc.approve(address(pool), 1e6));
        vm.prank(bob); pool.stake(id, 2, address(0), 1e6);
        vm.warp(deadline + 1);
        vm.prank(oracle); pool.resolve(id, 1, "proposed", bytes32(0));
        require(_safeCall(abi.encodeCall(MimirPoolErc20.setPaused, (true)), true));
        vm.warp(deadline + 1 + 7 days);
        pool.refundExpired(id);
        pool.claimFor(id, alice); pool.claimFor(id, bob);
        require(usdc.balanceOf(alice) == 10e6 - 5_000 && usdc.balanceOf(bob) == 10e6 - 5_000, "net stakes not refunded");
        require(pool.accruedFees(address(safe)) == 10_000, "entry fees changed on refund");
    }
}
