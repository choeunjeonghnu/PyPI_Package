const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const fs = require('fs');

// 🚩 금지 라이선스 목록
const bannedLicenses = ['GPL', 'AGPL', 'LGPL', 'SSPL', 'CC', 'Sleepycat'];

// 🚩 인기 기준 설정
const MIN_DOWNLOADS = 10000;
const MIN_STARS = 1000;
const MIN_FORKS = 100;

(async () => {
  try {
    // 1️⃣ requirements.txt 경로 입력 받기
    const packageListPath = core.getInput('package_list_path');
    const content = fs.readFileSync(packageListPath, 'utf-8');

    // 2️⃣ 패키지명만 추출
    const packages = content
      .split('\n')
      .map(line => line.trim().split(/[=<>!]/)[0])
      .filter(name => name);

    let hasIssue = false;

    for (const pkg of packages) {
      console.log(`\n🔍 패키지 점검 중: ${pkg}`);

      // === 3가지 기준 점검 ===

      // 3️⃣ [인기도 점검] pypistats 호출
      let popular = false;
      try {
        const res = await axios.get(`https://pypistats.org/api/packages/${pkg}/recent`);
        const downloads = res.data.data.last_month;
        console.log(`📈 지난 한 달 다운로드 수: ${downloads}회`);
        if (downloads >= MIN_DOWNLOADS) popular = true;
      } catch {
        console.log(`⚠️  ${pkg} 패키지의 다운로드 정보를 가져올 수 없습니다.`);
      }

      // 4️⃣ GitHub 저장소 찾기 (PyPI 메타데이터 조회)
      const pypiInfo = await axios.get(`https://pypi.org/pypi/${pkg}/json`);
      const info = pypiInfo.data.info;
      const repoUrl = info.project_urls?.Source || info.home_page;

      if (!repoUrl || !repoUrl.includes('github.com')) {
        console.log(`⚠️  ${pkg} 패키지의 GitHub 저장소 정보를 찾을 수 없습니다.`);
        hasIssue = true;
        continue;
      }

      const repoMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!repoMatch) {
        console.log(`⚠️  ${pkg} 패키지의 GitHub 저장소 URL이 올바르지 않습니다.`);
        hasIssue = true;
        continue;
      }

      const repoName = repoMatch[1];
      const token = process.env.GITHUB_TOKEN || core.getInput('token');
      const octokit = github.getOctokit(token);

      // 5️⃣ [인기도 보완] GitHub 스타 & 포크 수 확인
      const { data: repoData } = await octokit.rest.repos.get({
        owner: repoName.split('/')[0],
        repo: repoName.split('/')[1],
      });

      console.log(`⭐ 스타: ${repoData.stargazers_count}개, 🍴 포크: ${repoData.forks_count}개`);

      if (repoData.stargazers_count >= MIN_STARS || repoData.forks_count >= MIN_FORKS) {
        popular = true;
      }

      if (!popular) {
        console.log(`❌ [인기도] ${pkg} 패키지는 많이 사용되지 않는 것으로 판단됩니다.`);
        hasIssue = true;
      }

      // 6️⃣ [유지보수 점검]
      const lastPushed = new Date(repoData.pushed_at);
      const monthsSinceUpdate = (Date.now() - lastPushed) / (1000 * 60 * 60 * 24 * 30);

      if (monthsSinceUpdate > 6) {
        console.log(`❌ [유지보수] 최근 업데이트가 6개월 이상 되지 않았습니다.`);
        hasIssue = true;
      } else {
        console.log(`✅ [유지보수] 최근 업데이트가 양호합니다.`);
      }

      const openIssues = repoData.open_issues_count;
      console.log(`🐞 열린 이슈 수: ${openIssues}개`);
      if (openIssues > 100) {
        console.log(`❌ [유지보수] 열린 이슈가 너무 많습니다.`);
        hasIssue = true;
      }

      // 7️⃣ [라이선스 점검]
      const license = info.license || '정보 없음';
      console.log(`📜 라이선스: ${license}`);

      if (bannedLicenses.some(bad => license.includes(bad))) {
        console.log(`❌ [라이선스] 금지된 라이선스가 포함되어 있습니다.`);
        hasIssue = true;
      }
    }

    if (hasIssue) {
      core.setFailed('⚠️ 일부 패키지에서 문제가 발견되었습니다.');
    } else {
      console.log('🎉 모든 패키지가 건전성 점검을 통과했습니다!');
    }

  } catch (error) {
    core.setFailed(`오류 발생: ${error.message}`);
  }
})();
