// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {StakeHistory} from "../StakeHistory.sol";
interface HistoryVm { function warp(uint256) external; }
contract StakeHistoryTest {
    HistoryVm constant vm = HistoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    StakeHistory.Checkpoint[] private history;
    function testFuzz_strictCutoffCoalescesTimestampsWithoutTruncatingAmounts(uint128 seed, uint8 count) public {
        uint256 n = uint256(count) % 16 + 1;
        uint256 unit = uint256(seed) + 1;
        for (uint256 i; i < n; i++) {
            vm.warp(100 + i / 2);
            StakeHistory.record(history, StakeHistory.Amounts((i + 1) * unit, i * unit, i * unit / 2, i * unit / 3));
        }
        require(history.length == (n + 1) / 2, "equal timestamps not coalesced");
        for (uint256 at = 99; at <= 101 + n / 2; at++) {
            StakeHistory.Amounts memory actual = StakeHistory.before(history, at);
            uint256 eligible;
            for (uint256 i; i < n; i++) if (100 + i / 2 < at) eligible = i + 1;
            require(actual.a == eligible * unit, "strict cutoff or amount truncation");
            require(actual.b == (eligible == 0 ? 0 : (eligible - 1) * unit));
            require(actual.copiedA == (eligible == 0 ? 0 : (eligible - 1) * unit / 2));
            require(actual.copiedB == (eligible == 0 ? 0 : (eligible - 1) * unit / 3));
        }
        require(StakeHistory.before(history, 0).a == n * unit, "default excludes deposits");
    }
}
