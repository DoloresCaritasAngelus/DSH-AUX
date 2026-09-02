# Retired / Sleeping DSH-AUX patches

> 这些补丁/块文件目前 **不被主分支引用**，只做历史备份与未来参考。
> 主分支当前只支持 DSH `0.1.2-alpha.2` ~ `0.1.2-alpha.3`；旧版支持在
> `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 分支完整保留。
>
> DSH 仍处于破坏性更新阶段，这些旧实现未来可能用于找思路或直接复用，
> 因此保留在仓库中但不参与构建/安装/自愈。

## 为什么退役

- `dsh-host-apiproxy` 在 alpha.2/alpha.3 已不存在 → admit / selectModel 补丁不再适用。
- P9/P10 settings 动态暴露/白名单是 rc.6 专用 → alpha 线原生已具备，不再适用。
- `dsh-agent-loop` / `dsh-tool-subagent` 的 rc.8 老 `original` 锚点只服务于已抛弃的旧 DSH → 由 alpha2 锚点取代。
- v1 image-bridge 升级块只服务于 host-apiproxy 旧版 → 随 host-apiproxy 退役。

## 目录内容

| 文件 | 原用途 |
|---|---|
| apply-patch.host-apiproxy.mjs | 仅作为备份入口参考（不参与主分支） |
| patch-settings-dynamic-expose.mjs | rc.6 settings 动态暴露补丁 |
| patch-settings-allowlist.mjs | rc.6 settings 白名单补丁 |
| orig-block.txt / patched-block.txt / v1-block.txt | host-apiproxy admit image-bridge v1/v2 |
| orig-select-model-block.txt / patched-select-model-block.txt | host-apiproxy selectModel 门控 |
| orig-agent-loop-block.txt / patched-agent-loop-block.txt | rc.8 agent-loop 原始/补丁块 |
| orig-subagent-schema-block.txt / patched-subagent-schema-block.txt | rc.8 subagent schema 原始/补丁块 |
| orig-subagent-request-block.txt / patched-subagent-request-block.txt | rc.8 subagent request 原始/补丁块 |
| orig-settings-*.txt / patched-settings-*.txt | rc.6 settings 补丁块 |

> 如需恢复：从 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 分支取回原文件即可；
> 本目录只是保留一份当前 main 历史快照。

> 注意：本目录内的 `.mjs` 脚本移动后其相对 `../target.js` 引用不再直接可运行；
> 如需执行，请从 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 分支取原文件，或恢复 `bridge/` 对应位置后使用。
