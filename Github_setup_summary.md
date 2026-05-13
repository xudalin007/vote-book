# GitHub 配置与首次上传 — 问题清单

> 本次会话中由用户提出的问题与需求，按时间顺序整理。

## 1. 想把当前项目上传到 GitHub，刚创建账号，本地还没配置，请提供详细步骤
**问题目的：** 从零开始把本地 `vote-book` 项目托管到 GitHub，需要一份完整、可按顺序执行的入门指南。

## 2. 改为直接在本地命令行创建仓库，重新整理步骤
**问题目的：** 不想到 GitHub 网页点按钮，希望全流程用命令行完成（包含远程仓库的创建动作）。

## 3. 开始执行第一步（安装 GitHub CLI）
**问题目的：** 启动落地，先把 `gh` 工具装上，作为后续命令行操作的基础。

## 4. 完成 `gh auth login` 后,帮我跑 `gh auth status` 验证
**问题目的：** 确认登录态有效、协议为 SSH、权限范围（scopes）足够创建仓库。

## 5. 提供 Git 身份:用户名 `xudalin007`、邮箱 `xudalin007@gmail.com`
**问题目的：** 配置 `git config --global`,让 commit 携带正确作者信息并能正确归属到 GitHub 账号。

## 6. 执行第 4 步(检查敏感文件 + 写 `.gitignore`)
**问题目的：** 防止把含密码哈希的 `user.json`、运行时数据 `vote.json` 等敏感/非源代码文件推上公开仓库。

## 7. 继续(确认 `git init` + `git add` 后的暂存清单无误)
**问题目的：** 在创建首个 commit 之前,核对敏感文件确实被忽略、应提交的文件齐全。

## 8. 继续(确认使用 `Initial commit` 作为首个提交消息)
**问题目的：** 完成首次本地提交,固化项目初始快照。

## 9. 仓库名沿用 `vote-book`,可见性选择「公开」
**问题目的：** 通过 `gh repo create` 一条命令创建远程仓库、添加 remote、并推送首个 commit。

---

## 本次会话主线

围绕 **「从零开始把本地 `vote-book` 项目托管到个人 GitHub 账号」** 这一目标,依次完成:

1. **环境准备** — 安装 `gh` CLI、`gh auth login` 配置 SSH 协议、写入 `git config` 全局身份。
2. **安全检查** — 识别 `user.json`(密码哈希)、`vote.json`(运行时数据)等敏感文件,扫描 `server.js` 排查硬编码密钥,编写 `.gitignore`。
3. **本地仓库初始化** — `git init` → `git add .` → 核对清单(发现并剔除 `.claude/settings.local.json`)→ `git commit`。
4. **远程仓库创建与推送** — `gh repo create vote-book --public --source=. --remote=origin --push`。
5. **SSH host key 信任配置** — `ssh-keyscan` 抓取 GitHub 主机公钥,与官方指纹核对后写入 `~/.ssh/known_hosts`,完成首次 push。

最终成果:仓库已上线 https://github.com/xudalin007/vote-book ,本地 `main` 已跟踪 `origin/main`。

---

## 待办事项

- [ ] (可选)补一份 `README.md`,让 GitHub 仓库首页有项目介绍和使用说明。
- [ ] 复核 `spec.md` / `task.md` 是否适合保持公开(当前已随公开仓库一同发布)。
- [ ] 形成日常提交习惯:`git add <文件>` → `git commit -m "说明"` → `git push`。
- [ ] 后续如新增 `.env` 或任何含第三方密钥/令牌的文件,先确认已被 `.gitignore` 覆盖再提交。
- [ ] (可选)把 `Github_setup_summary.md` 自身加入 `.gitignore`,因为它属于本地会话记录,通常不需要进版本控制。

