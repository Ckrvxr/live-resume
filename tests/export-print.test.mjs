import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createArtifacts, openResume } from './helpers.mjs';

test('Markdown export and print button work', { timeout: 120_000 }, async t => {
  const artifacts = await createArtifacts('resume-export-print');
  const { browser, evaluate } = await openResume(t);
  assert.equal(await evaluate('document.title'), '曹锐旋简历');

  const markdownPath = resolve(artifacts, 'resume.md');
  await browser('download', '#markdown-button', markdownPath);
  const markdown = await readFile(markdownPath, 'utf8');
  assert(markdown.includes('# 曹锐旋'));
  assert(markdown.includes('> 意向：嵌入式硬件工程师'));
  assert(markdown.includes('## 个人概况'));
  assert(!markdown.includes('MBTI'));
  assert(!markdown.includes('INTP'));
  const profileMarkdown = markdown.split('## 个人概况')[1].split('## 联系方式')[0];
  assert(!profileMarkdown.includes('- 届别：27届'));
  assert.match(profileMarkdown, /^### 教育经历$/m);
  assert(profileMarkdown.includes('**惠州学院** · **27届**'));
  assert(profileMarkdown.includes('电子信息工程（本科）'));
  assert(profileMarkdown.includes('*2023.09 — 至今*'));
  assert(!profileMarkdown.includes('主修课程'));
  assert.doesNotMatch(profileMarkdown, /^>\s*$/m);
  assert.doesNotMatch(markdown, /^## 教育经历$/m);
  assert(markdown.includes('- 手机：+86 131 1332 8451'));
  assert(markdown.includes('| 能力方向 | 技能 |'));
  assert(markdown.includes('| --- | --- |'));
  assert(markdown.includes('| 语言能力 |'));
  assert(markdown.includes('**英语六级** · **C/C++** · Rust · **Python**'));
  for (const absentText of ['粤语', 'JS', '数据结构与算法', '控制理论', 'Markdown', 'Makefile', 'SSH', 'uv', 'U8g2', 'ReAct', 'PyTorch', '电子负载', 'DDS']) {
    assert(!markdown.includes(absentText), `${absentText} should not appear in the export`);
  }
  assert(markdown.includes('**LTspice** · **KiCad** · **Altium Designer**'));
  assert(markdown.includes('| 硬件开发 | **原理图设计** · **PCB 布局** · 焊接调试 · **LTspice** · **KiCad** · **Altium Designer** · **示波器** · **逻辑分析仪** · **信号发生器** |'));
  assert(markdown.includes('| 嵌入式软件开发 | **STM32** · ESP32 · **FreeRTOS** · **UART/SPI/I²C/CAN** · **ADC/DAC** |'));
  assert(!markdown.includes('| 测试与仿真 |'));
  assert(!markdown.includes('| AI/ML |'));
  assert(markdown.includes('| 理论基础 | 数电 · 模电 · 开关电源 · 微机原理 · **计算机原理** · **计算机网络** |'));
  assert(!markdown.includes('### 语言能力'));
  assert(markdown.includes('[作品集](https://ckrvxr.notion.site/sets)：项目经历与技术实践'));
  assert(markdown.includes('[GitHub](https://github.com/ckrvxr)'));
  assert(markdown.includes('## 个人简介'));
  assert(markdown.includes('### RoboMaster 战队｜硬件组组长'));
  assert(markdown.includes('- 负责电源模块设计、单片机核心板设计与机器人布线工作。'));
  assert(markdown.includes('- 负责电控底盘代码编写与软硬件协同调试。'));
  assert(markdown.includes('- 负责制定硬件组技术规范、教学文档，培训新成员。'));
  assert(!markdown.includes('（非甲级队伍）'));
  const awards = markdown.split('## 获奖情况')[1].split('## 代表项目')[0].trim().split('\n');
  assert.deepEqual(awards, [
    '- RoboMaster 2026 高校联盟赛 华南站 工程挑战赛 **一等奖**',
    '- RoboMaster 2024 高校联盟赛 华南站 步兵对抗赛 **二等奖**',
    '- RoboMaster 2026 高校联盟赛 华南站 3v3 对抗赛 **三等奖**',
    '- RoboMaster 2025 高校联盟赛 福建站 3v3 对抗赛 **三等奖**',
  ]);
  assert(markdown.includes('## 代表项目'));
  assert(markdown.includes('### 基于 CNN 神经网络的 ESP32-S3 心率手环'));
  assert(!markdown.includes('ESP32-S3 心率手环与 CNN 心率检测模型训练'));
  assert(markdown.includes('- 对机甲布线与电源分配进行**系统性重构**，制定并落实电缆选用、接口定义及接线规范，**大幅**减少硬件故障导致的开发中断与跨组联调阻塞。'));
  assert(markdown.includes('**团队** · *2026.05 — 2026.07*'));

  await evaluate('window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; true');
  await browser('click', '#print-button');
  assert.equal(await evaluate('window.__printCalls'), 1);

  assert.deepEqual((await browser('errors')).errors, []);
});
