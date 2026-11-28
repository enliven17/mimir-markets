// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MimirPoolErc20, IMimirFees as IPoolFees, IUsdc as IPoolUsdc} from "../MimirPoolErc20.sol";
import {MimirV3Erc20, IMimirFees as IV3Fees, IUsdc as IV3Usdc} from "../MimirV3Erc20.sol";
import {MimirBscFees, IAgentIdRegistry} from "../MimirBscFees.sol";

interface Vm {
    function warp(uint256) external;
    function chainId(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
}

/// 18-decimal ERC-20 stand-in for Binance-Peg USDC on BNB Smart Chain (no EIP-2612 permit).
contract MockUsdc18 {
    string public constant name = "Binance-Peg USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allow");
        require(balanceOf[from] >= amount, "bal");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockBadDecimalsUsdc {
    uint8 public constant decimals = 8;
}

contract MockAgentId is IAgentIdRegistry {
    mapping(address => uint256) public balanceOf;

    function grant(address to) external {
        balanceOf[to] = 1;
    }
}

contract RevertingAgentId is IAgentIdRegistry {
    function balanceOf(address) external pure returns (uint256) {
        revert("boom");
    }
}

contract BscErc20Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address owner = address(0xA11CE);
    address arbiter = address(0xA2B1);
    address oracle = address(0x02AC1E);
    address feeTo = address(0xFEE);
    address feeSigner = address(0x5160);
    address alice = address(0x1111); // Agent ID holder
    address bob = address(0x2222);   // Regular user

    uint256 constant T0 = 1_700_000_000;

    MockUsdc18 usdc;
    MockAgentId agentId;
    MimirBscFees fees;
    MimirPoolErc20 pool;
    MimirV3Erc20 vs;

    function setUp() public {
        vm.warp(T0);
        vm.chainId(97); // BSC Testnet
        usdc = new MockUsdc18();
        agentId = new MockAgentId();
        agentId.grant(alice);

        fees = new MimirBscFees(owner, feeSigner, agentId);
        pool = new MimirPoolErc20(
            owner,
            arbiter,
            oracle,
            feeTo,
            IPoolFees(address(fees)),
            3600,
            1e17, // 0.1 USDC (18 dp)
            IPoolUsdc(address(usdc))
        );
        vs = new MimirV3Erc20(
            owner,
            arbiter,
            oracle,
            feeTo,
            IV3Fees(address(fees)),
            3600,
            1e17, // 0.1 USDC (18 dp)
            IV3Usdc(address(usdc))
        );

        usdc.mint(alice, 100e18);
        usdc.mint(bob, 100e18);
    }

    function test_bscConstantsAndAgentIdFees() public view {
        require(pool.MIN_STAKE_FLOOR() == 1e16, "pool floor");
        require(pool.MIN_STAKE_CEILING() == 100e18, "pool ceiling");
        require(pool.DISPUTE_BOND() == 2e18, "pool bond");
        require(vs.MIN_STAKE_FLOOR() == 1e16, "vs floor");
        require(vs.MIN_STAKE_CEILING() == 100e18, "vs ceiling");
        require(vs.DISPUTE_BOND() == 2e18, "vs bond");

        require(fees.hasAgentId(alice), "alice agent id");
        require(!fees.hasAgentId(bob), "bob agent id");
        require(fees.entryBps(alice) == 0, "alice 0 bps");
        require(fees.entryBps(bob) == 50, "bob 50 bps");
    }

    function test_revertingAgentIdRegistryNeverBlocksEntry() public {
        RevertingAgentId bad = new RevertingAgentId();
        MimirBscFees safeFees = new MimirBscFees(owner, feeSigner, bad);
        require(!safeFees.hasAgentId(alice), "fallback false");
        require(safeFees.entryBps(alice) == 50, "fallback 50 bps");
    }

    function test_bscMainnetRequires24hDisputeWindow() public {
        vm.chainId(56); // BSC Mainnet
        vm.expectRevert(MimirPoolErc20.WindowTooShort.selector);
        new MimirPoolErc20(owner, arbiter, oracle, feeTo, IPoolFees(address(fees)), 3600, 1e17, IPoolUsdc(address(usdc)));

        vm.expectRevert(MimirV3Erc20.WindowTooShort.selector);
        new MimirV3Erc20(owner, arbiter, oracle, feeTo, IV3Fees(address(fees)), 3600, 1e17, IV3Usdc(address(usdc)));

        MimirPoolErc20 livePool =
            new MimirPoolErc20(owner, arbiter, oracle, feeTo, IPoolFees(address(fees)), 86400, 1e17, IPoolUsdc(address(usdc)));
        require(livePool.disputeWindow() == 86400, "live window");
    }

    function test_rejectsUnsupportedDecimals() public {
        MockBadDecimalsUsdc bad = new MockBadDecimalsUsdc();
        vm.expectRevert(MimirPoolErc20.BadUsdcDecimals.selector);
        new MimirPoolErc20(owner, arbiter, oracle, feeTo, IPoolFees(address(fees)), 3600, 1e17, IPoolUsdc(address(bad)));
    }

    function test_poolFullLifecycleWithAgentIdZeroFeeAndDisputeBond() public {
        uint256 deadline = T0 + 2 hours;

        // Alice (Agent ID holder) opens market with 10 USDC -> 0% fee -> full 10e18 staked
        vm.startPrank(alice);
        usdc.approve(address(pool), 10e18);
        uint256 id = pool.createMarket("Will BNB > $700?", "Yes", "No", "https://example.com", "crypto", deadline, 1, address(0), 10e18);
        vm.stopPrank();
        require(pool.stakeA(id, alice) == 10e18, "alice full stake");
        require(pool.accruedFees(feeTo) == 0, "no fee for agent id");

        // Bob (no Agent ID) stakes 10 USDC on side B -> 0.5% fee (0.05 USDC) -> 9.95e18 staked
        vm.startPrank(bob);
        usdc.approve(address(pool), 12e18);
        pool.stake(id, 2, address(0), 10e18);
        vm.stopPrank();
        require(pool.stakeB(id, bob) == 9.95e18, "bob net stake");
        require(pool.accruedFees(feeTo) == 0.05e18, "bob fee");

        // Warp past deadline, oracle proposes Side B, Alice disputes with 2e18 bond, Arbiter rules Side A
        vm.warp(deadline + 1);
        vm.prank(oracle);
        pool.resolve(id, 2, "wrong", keccak256("ev1"));

        vm.startPrank(alice);
        usdc.approve(address(pool), 2e18);
        pool.dispute(id);
        vm.stopPrank();

        vm.prank(arbiter);
        pool.resolveDispute(id, 1, "corrected", keccak256("ev2"));

        // Alice gets her 2e18 bond back + claims 19.95e18 payout
        uint256 beforeClaim = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.claim(id);
        require(usdc.balanceOf(alice) - beforeClaim == 19.95e18, "alice payout");
    }

    function test_vsFullLifecycleWithAgentIdZeroFee() public {
        uint256 deadline = T0 + 2 hours;

        // Alice (Agent ID holder) creates VS claim with 5 USDC -> 0% fee
        vm.startPrank(alice);
        usdc.approve(address(vs), 5e18);
        uint256 id = vs.createClaim(
            "Will BTC close green?",
            "Yes",
            "No",
            "https://example.com",
            deadline,
            5e18,
            "crypto",
            0,
            "binary",
            "pool",
            20_000,
            "",
            "",
            10,
            false,
            "",
            address(0)
        );
        vm.stopPrank();
        require(vs.accruedFees(feeTo) == 0, "vs agent id 0 fee");

        // Bob challenges with 5 USDC -> 0.5% fee (0.025 USDC)
        vm.startPrank(bob);
        usdc.approve(address(vs), 5e18);
        vs.challengeClaim(id, 5e18, "", address(0));
        vm.stopPrank();
        require(vs.accruedFees(feeTo) == 0.025e18, "vs bob fee");

        // Oracle proposes Creator (1), wait dispute window, finalize
        vm.warp(deadline + 1);
        vm.prank(oracle);
        vs.resolveClaimWithCutoff(id, 1, "Yes", 95, keccak256("ev"), 0);
        vm.warp(deadline + 3602);
        uint256 before = usdc.balanceOf(alice);
        vs.finalizeResolution(id);
        require(usdc.balanceOf(alice) - before == 9.975e18, "vs alice payout");
    }

    /// Sentinel: an Agent ID holder with no position disputes a wrong proposal and gets the bond back.
    function test_agentIdSentinelDisputesWithoutPosition() public {
        address sentinel = address(0x5E47);
        agentId.grant(sentinel);
        usdc.mint(sentinel, 10e18);
        uint256 deadline = T0 + 2 hours;

        vm.startPrank(bob);
        usdc.approve(address(pool), 10e18);
        uint256 id = pool.createMarket("Will BNB > $700?", "Yes", "No", "https://example.com", "crypto", deadline, 1, address(0), 5e18);
        vm.stopPrank();
        vm.warp(deadline + 1);
        vm.prank(oracle);
        pool.resolve(id, 2, "wrong", keccak256("ev1"));

        // A non-holder outsider is refused.
        address outsider = address(0x0B5);
        usdc.mint(outsider, 10e18);
        vm.startPrank(outsider);
        usdc.approve(address(pool), 2e18);
        vm.expectRevert(MimirPoolErc20.NotParticipant.selector);
        pool.dispute(id);
        vm.stopPrank();

        vm.startPrank(sentinel);
        usdc.approve(address(pool), 2e18);
        pool.dispute(id);
        vm.stopPrank();
        require(usdc.balanceOf(sentinel) == 8e18, "bond pulled");

        vm.prank(arbiter);
        pool.resolveDispute(id, 1, "corrected", keccak256("ev2"));
        require(usdc.balanceOf(sentinel) == 10e18, "bond returned");
    }

    function test_agentIdSentinelDisputesVsClaim() public {
        address sentinel = address(0x5E47);
        agentId.grant(sentinel);
        usdc.mint(sentinel, 10e18);
        uint256 deadline = T0 + 2 hours;
        vm.startPrank(bob);
        usdc.approve(address(vs), 5e18);
        uint256 id = vs.createClaim("Q?", "Yes", "No", "https://example.com", deadline, 5e18, "crypto", 0, "binary", "pool", 20_000, "", "", 10, false, "", address(0));
        vm.stopPrank();
        vm.startPrank(alice);
        usdc.approve(address(vs), 5e18);
        vs.challengeClaim(id, 5e18, "", address(0));
        vm.stopPrank();
        vm.warp(deadline + 1);
        vm.prank(oracle);
        vs.resolveClaimWithCutoff(id, 1, "Yes", 95, keccak256("ev"), 0);

        vm.startPrank(sentinel);
        usdc.approve(address(vs), 2e18);
        vs.disputeResolution(id);
        vm.stopPrank();
        require(usdc.balanceOf(sentinel) == 8e18, "vs bond pulled");
    }
}
