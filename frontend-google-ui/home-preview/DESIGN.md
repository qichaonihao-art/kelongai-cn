---
name: AI 创意工作台 · 本地主页提案
description: 深青导航、雾白工作区与浅绿动作强调的日常创作入口；尚未采纳为正式设计系统。
colors:
  ink: "#193135"
  muted: "#627173"
  canvas: "#f5f7f5"
  line: "#dce4df"
  navigation: "#112c32"
  accent: "#c7e9ac"
  focus: "#257a6a"
typography:
  heading:
    fontFamily: "PingFang SC, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "PingFang SC, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.55
  tool-description:
    fontSize: "12px"
rounded:
  action: "6px"
  feature: "12px"
spacing:
  content: "40px"
  mobile: "18px"
components:
  primary-button:
    backgroundColor: "{colors.accent}"
    textColor: "#193930"
    rounded: "{rounded.action}"
    padding: "10px 16px"
---

# Design System: 本地主页提案

## Overview

本轮仅验证主页的视觉和使用体验。深青侧栏区分导航与工作内容；主入口采用不等宽布局，工具列表采用紧凑行布局。正式入口、原主页、业务接口和生成逻辑不受影响。本文件描述已实现的提案，不是用户已批准的全站规范。

## Colors

颜色来自 home.css 的 --hp-* 属性。浅绿用于主要动作和当前筛选状态，日常阅读采用浅色底、深色文字。没有伪造在线状态、任务数或素材数。

## Typography

中文系统字体优先，无新增外部字体请求。标题为 26px，重点创意入口为 30px，工具名称 14px，说明 12px。移动端作固定字号调整。

## Layout

桌面侧栏 224px，1250px 以下为 206px；760px 以下改为抽屉。主区左右留白 40px，窄屏 26px/20px/18px。工具列表由三列降至两列、一列。40px 顶栏为独立预览工具栏，不是正式主页的一部分。

## Elevation & Depth

以色块和细分隔线建立层次，无大面积模糊、粒子或持续背景动画。

## Shapes

主入口 12px 圆角，按钮 6px，导航 7–8px。几何插图为内联 SVG，无位图和远程素材。

## Components

搜索支持功能别名、无结果反馈和 Cmd/Ctrl+K。用途筛选为带 aria-pressed 的标准按钮。工具入口使用原模块组件；预览服务对 /api/* 返回 503，禁止连接线上任务。

移动导航关闭时设置 inert；展开后限制焦点范围，Escape 关闭并归还焦点。遵循 prefers-reduced-motion。最近使用与标语使用独立 localStorage 键，仅作用当前设备的本地提案。

## Do's and Don'ts

不修改其他模块的外观或逻辑。不把本地最近访问伪装成创作记录。不在采用本设计前把本文作为全站规范。

## 本轮内页扩展（本地提案）

九个站内模块继承同一侧栏、面包屑与页面标题。内页用 modules.css 的局部 token 将品牌色统一到深青/浅绿，语义红色、警告色及店铺图谱类别颜色不归并。长编辑器按内容增长，图片/模型保留有界对话区；窄屏历史侧栏默认收起。

原业务组件通过独立预览路由复用。提示词、接口协议、产品信息、生成任务和媒体本身不在视觉层修改。原版可在当前模块对比。全局工具搜索保留编辑器实例和输入内容。

内页新增字号：25px 页面标题、22/19px 创作入口、18px 内部标题、13/12px 正文，11px 紧凑标签及手机示例按钮。modules.css 中的品牌色阶为浅绿 #f1f6ed → #e3eddc → #c9ddbc → #a9c8a1 → #81ac86 → #447d60 → #3d7560 → #2d5e4e → #254b40 → #1b3a32 → #112b27；中性色使用局部 slate 色阶，图谱节点保留自身分类色。

机械检查提示若干新增颜色与字号未列入初版 YAML 的 advisory；它们属于本轮内页扩展，不代表全站设计规范已批准。后续采用时再把完整色阶和字号正式提取成共享组件规范。
