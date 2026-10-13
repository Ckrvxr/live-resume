import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createArtifacts, openResume, root } from './helpers.mjs';

test('resume content matches the intended profile, skills, and experience', { timeout: 120_000 }, async t => {
  const source = await readFile(resolve(root, 'index.html'), 'utf8');
  assert(!source.includes('export.js'));
  assert(!source.includes('server.mjs'));
  assert(!source.includes('/api/pdf'));

  const artifacts = await createArtifacts('resume-content');
  const { browser, evaluate } = await openResume(t);
  const screen = await evaluate(`(() => {
    const skillGroups = [...document.querySelectorAll('.skill-group')].map(group => ({
      name: group.querySelector('strong').innerText,
      skills: [...group.querySelectorAll('.skill-chips li')].map(node => node.innerText),
    }));
    return {
      favicon: document.querySelector('link[rel="icon"]').getAttribute('href'),
      buttons: ['pdf', 'print', 'markdown', 'theme', 'lock'].map(name => document.querySelectorAll('#' + name + '-button').length),
      editable: document.querySelector('.name').isContentEditable,
      skillGroups,
      chipWeights: Object.fromEntries([...document.querySelectorAll('.skill-chips li')].map(node => [node.innerText, getComputedStyle(node).fontWeight])),
      chipBackgrounds: [...document.querySelectorAll('.skill-chips li')].map(node => getComputedStyle(node).backgroundColor),
      profileFacts: [...document.querySelectorAll('.facts li')].map(node => node.innerText),
      profileEducation: document.querySelector('.sidebar [aria-labelledby="profile-heading"] [aria-labelledby="education-heading"]')?.innerText,
      mainEducationCount: document.querySelectorAll('.main [aria-labelledby="education-heading"]').length,
      intro: document.querySelector('.intro').innerText,
      campus: document.querySelector('[aria-labelledby="campus-heading"] .entry').innerText,
      awards: [...document.querySelectorAll('[aria-labelledby="award-heading"] .detail li')].map(node => node.innerText),
      projectTitles: [...document.querySelectorAll('[aria-labelledby="projects-heading"] .entry-title')].map(node => node.innerText),
      onlineItems: [...document.querySelectorAll('.online-list > li')].map(item => ({
        title: item.querySelector('.online-name').innerText,
        description: item.querySelector('.online-description').innerText,
        href: item.querySelector('.link-value').getAttribute('href'),
      })),
      bodyText: document.body.innerText,
    };
  })()`);

  assert.equal(screen.favicon, 'assets/nailong.svg');
  assert.deepEqual(screen.buttons, [0, 1, 1, 0, 0]);
  assert.equal(screen.editable, false);
  assert.deepEqual(screen.skillGroups.map(group => group.name), [
    '语言能力', '硬件开发', '嵌入式软件开发', '操作系统与工具链', '理论基础',
  ]);
  const skillsByGroup = Object.fromEntries(screen.skillGroups.map(group => [group.name, group.skills]));
  assert.deepEqual(skillsByGroup['语言能力'], ['英语六级', 'C/C++', 'Rust', 'Python']);
  assert.deepEqual(skillsByGroup['硬件开发'], ['原理图设计', 'PCB 布局', '焊接调试', 'LTspice', 'KiCad', 'Altium Designer', '示波器', '逻辑分析仪', '信号发生器']);
  assert.deepEqual(skillsByGroup['嵌入式软件开发'], ['STM32', 'ESP32', 'FreeRTOS', 'UART/SPI/I²C/CAN', 'ADC/DAC']);
  assert.deepEqual(skillsByGroup['操作系统与工具链'], ['Linux', 'Git', 'CI/CD', 'CMake', 'Docker', 'OpenOCD', 'VS Code']);
  assert.deepEqual(skillsByGroup['理论基础'], ['数电', '模电', '开关电源', '微机原理', '计算机原理', '计算机网络']);
  assert.deepEqual(new Set(Object.values(screen.chipWeights)), new Set(['400']));
  assert.deepEqual(new Set(screen.chipBackgrounds), new Set(['rgb(241, 243, 242)']));
  assert.deepEqual(screen.profileFacts, ['性别：男', '年龄：21岁', '籍贯：广州']);
  assert.equal(screen.mainEducationCount, 0);
  assert(screen.profileEducation.includes('惠州学院'));
  assert(screen.profileEducation.includes('27届'));
  assert(screen.profileEducation.includes('电子信息工程（本科）'));
  assert(screen.profileEducation.includes('2023.09 — 至今'));
  assert(!screen.profileEducation.includes('主修课程'));
  assert(screen.intro.includes('在 RM 战队担任硬件开发工作 3 年，深度参与高密度 PCB 设计与嵌入式软件开发。'));
  assert(screen.intro.includes('能够无障碍查阅各类英文技术文献，独立定位问题并开展软硬件协同调试。'));
  assert(screen.intro.includes('善于在 Linux 操作系统使用 Git、Agent 等工具进行快速开发。'));
  assert(screen.campus.includes('RoboMaster 战队｜硬件组组长'));
  assert(!screen.campus.includes('惠州学院'));
  assert.deepEqual(screen.awards, [
    'RoboMaster 2026 高校联盟赛 华南站 工程挑战赛 一等奖',
    'RoboMaster 2024 高校联盟赛 华南站 步兵对抗赛 二等奖',
    'RoboMaster 2026 高校联盟赛 华南站 3v3 对抗赛 三等奖',
    'RoboMaster 2025 高校联盟赛 福建站 3v3 对抗赛 三等奖',
  ]);
  assert(screen.projectTitles.some(title => title.includes('基于 CNN 神经网络的 ESP32-S3 心率手环')));
  assert(screen.projectTitles.some(title => title.includes('面向 RoboMaster 机甲的 Buck-Boost 超电模块')));
  assert.deepEqual(screen.onlineItems.map(item => item.title), ['作品集', 'GitHub']);
  assert.equal(screen.onlineItems[0].description, '项目经历与技术实践');
  assert.equal(screen.onlineItems[0].href, 'https://ckrvxr.notion.site/sets');
  for (const removedText of ['U8g2', '控制理论', '数据结构与算法', '粤语', 'JS', 'ReAct', '电子负载', 'DDS']) {
    assert(!screen.bodyText.includes(removedText), `${removedText} should not appear in the resume`);
  }

  await browser('screenshot', resolve(artifacts, 'desktop.png'));
});
