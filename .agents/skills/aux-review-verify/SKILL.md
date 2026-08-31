---
name: aux-review-verify
description: DSH-AUX PR/外部 review 报告验证纪律——不盲信报告,每条结论落到代码/测试证据;用子代理交叉验证但自己必须跑关键命令。
user-invocable: false
---

# aux-review-verify(PR / review 验证纪律)

> 🔻**易腐烂标注**:**验证流程、分类方法、修复优先级、同步规则**是稳定纪律;
> **测试基线、命令输出、文件行号、提交号**是快照,引用前以仓库当前状态为准。

## 为什么需要这个 SKILL
外部 AI review 报告(或其他协作者的 review)会混入:
- ✅ 真实问题;
- ⚠️ 部分成立 / 被高估的风险;
- ❌ 误报;
- 以及**报告完全没提、但实际更严重的 bug**。

因此收到 review 后**不能直接照单全改**,也不能因为报告“说得严重”就阻塞合入。
本 SKILL 固定一套可重复的验证流程。

## 铁律
1. **不盲信报告**。每条 Blocker / Concern 必须落到代码、diff、测试或可复现实验。
2. **自己必须跑关键命令**,不能只靠子代理或报告结论。
3. **修复前先分类**:真实 / 部分成立 / 误报 / 理论风险。
4. **修复必须带回归测试或至少可验证的行为变化**;只改代码不留证据不算完成。
5. **改动文档/README/测试基线后必须同步**:
   - 根 README + README.en + 生成副本(`npm run gen-package-readme`);
   - `TESTING.md`、`CHANGELOG.md`、相关 SKILL 基线;
   - 新增测试数变化后全仓基线同步。
6. **不因为“理论风险”无限上纲**:能低成本加固就加固,不能则记录为后续债。

## 验证清单(收到 review 后)
1. 先看改动范围:
   ```bash
   git diff origin/main..HEAD --stat
   git diff origin/main..HEAD --check
   ```
2. 跑基线测试:
   ```bash
   node --test tests/*.test.js
   ```
3. 跑仓库自带 CI 辅助检查:
   ```bash
   node scripts/ci-syntax-check.mjs
   node scripts/ci-fake-dsh.mjs            # bridge 补丁 dry-run
   node scripts/gen-package-readme.mjs --check
   bash -n install.sh update.sh
   ```
4. 对报告每条结论做“证据映射”:
   - 指出代码位置 / 行号 / diff 块;
   - 必要时写临时复现脚本(放在 `/tmp`,不落仓库);
   - 判断是真实、部分成立、误报还是理论风险。
5. 可发动**独立子代理**交叉验证:
   - 一个子代理“不看报告独立审代码”;
   - 一个子代理“逐条验证报告”;
   - 自己仍要亲自跑关键命令,不能把判断外包。

## 分类口径
| 分类 | 定义 | 处理 |
|---|---|---|
| ✅ 真实 | 代码/diff/复现实验均支持 | 按优先级修 |
| ⚠️ 部分成立 | 方向对,但影响被夸大或场景不成立 | 低成本加固可修;写明真实边界 |
| ❌ 误报 | 代码事实不支持 | 不修;记录为何误报 |
| 🧊 理论风险 | 当前调用图/仓库状态不会触发,但未来可能 | 可加固可不加固;记入维护债 |

## 修复优先级
1. **真实 Blocker / 文档单一真相破裂** → 立即修;
2. **报告没提但子代理/自己发现的高风险 bug**(如 unhandled rejection、数据复活、宿主退出被截断)→ 修;
3. **低风险 Concern / 理论风险** → 能低成本修就修,否则记录;
4. **架构级优化**(如给脚本加 `--json` / 结构化退出码)→ 可以列入后续,不阻塞当前 PR。

## 常见错误
- 把 review 报告当 ground truth,逐条照改 → 可能引入没必要的破坏。
- 只跑子代理,自己不跑测试 → 结论可能被子代理的上下文/幻觉污染。
- 修完不加测试/不同步 README/TESTING → 留下新的文档债。
- 把“并发/极端场景”当成必然发生 → 要区分理论风险与真实复现。
- 报告说 Blocker 就恐慌 → 先看是否是“被高估”;同时也要找报告没提的真问题。

## 关联 SKILL
- `aux-test-baseline`:测试基线与回归纪律;
- `aux-github-workflow`:PR 分支/推送/凭据纪律;
- `aux-dsh-follow`:DSH 版本升级与兼容矩阵;
- `aux-patch-discipline`:bridge 补丁只走 bridge/、锚点不中跳过。