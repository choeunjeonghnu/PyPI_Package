const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const fs = require('fs');

const bannedLicenses = ['GPL', 'AGPL', 'LGPL', 'SSPL', 'CC', 'Sleepycat'];

const MIN_DOWNLOADS = 10000;
const MIN_STARS = 1000;
const MIN_FORKS = 100;
const LARGE_PROJECT_DOWNLOADS = 1000000;
const MAX_OPEN_ISSUES = 100;
const MAX_OPEN_ISSUES_LARGE = 500;

(async () => {
  try {
    const packageListPath = core.getInput('package_list_path');
    const token = process.env.GITHUB_TOKEN || core.getInput('token');
    const octokit = github.getOctokit(token, {
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: console.error }
    });

    const content = fs.readFileSync(packageListPath, 'utf-8');
    const packages = content
      .split('\n')
      .map(line => line.trim().split(/[=<>!]/)[0])
      .filter(name => name);

    let hasIssue = false;

    for (const pkg of packages) {
      console.log(`\n🔍 패키지 점검 중: ${pkg}`);

      const pypiInfo = await axios.get(`https://pypi.org/pypi/${pkg}/json`);
      const info = pypiInfo.data.info;

      // === 인기도 점검 ===
      let popular = false;
      try {
        const res = await axios.get(`https://pypistats.org/api/packages/${pkg}/recent`);
        const downloads = res.data.data.last_month;
        console.log(`📈 지난 한 달 다운로드 수: ${downloads}회`);
        if (downloads >= MIN_DOWNLOADS) popular = true;
      } catch {
        console.log(`⚠️  ${pkg} 패키지의 다운로드 정보를 가져올 수 없습니다.`);
      }

      // === GitHub 저장소 찾기 ===
      let githubUrl = null;
      const urls = Object.values(info.project_urls || {});
      githubUrl = urls.find(url => url.includes('github.com'));

      if (!githubUrl && info.home_page && info.home_page.includes('github.com')) {
        githubUrl = info.home_page;
      }

      let repoData = null;
      if (githubUrl) {
        const repoMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
        if (repoMatch) {
          const repoName = repoMatch[1];

          const { data } = await octokit.rest.repos.get({
            owner: repoName.split('/')[0],
            repo: repoName.split('/')[1],
          });
          repoData = data;

          console.log(`⭐ 스타: ${repoData.stargazers_count}개, 🍴 포크: ${repoData.forks_count}개`);

          if (repoData.stargazers_count >= MIN_STARS || repoData.forks_count >= MIN_FORKS) {
            popular = true;
          }

          const lastPushed = new Date(repoData.pushed_at);
          const monthsSinceUpdate = (Date.now() - lastPushed) / (1000 * 60 * 60 * 24 * 30);

          if (monthsSinceUpdate > 6) {
            console.log(`❌ [유지보수] 최근 업데이트가 6개월 이상 없습니다.`);
            hasIssue = true;
          } else {
            console.log(`✅ [유지보수] 최근 업데이트 양호`);
          }

          const searchResult = await octokit.rest.search.issuesAndPullRequests({
            q: `repo:${repoName} is:issue is:open`,
          });
          const openIssues = searchResult.data.total_count;
          console.log(`🐞 열린 이슈 수: ${openIssues}개`);

          if (downloads >= LARGE_PROJECT_DOWNLOADS) {
            if (openIssues > MAX_OPEN_ISSUES_LARGE) {
              console.log(`⚠️ 대형 프로젝트로 판단되어 이슈 수는 참고용으로 표시합니다.`);
            }
          } else {
            if (openIssues > MAX_OPEN_ISSUES) {
              console.log(`❌ [유지보수] 열린 이슈가 너무 많습니다.`);
              hasIssue = true;
            }
          }
        }
      } else {
        console.log(`⚠️ GitHub 저장소를 찾을 수 없어 유지보수 점검은 생략됩니다.`);
      }

      // === 인기도 최종 판단 ===
      if (!popular) {
        console.log(`❌ [인기도] ${pkg} 패키지는 널리 사용되지 않는 것으로 판단됩니다.`);
        hasIssue = true;
      } else {
        console.log(`✅ [인기도] 널리 사용되는 패키지입니다.`);
      }

      // === 라이선스 점검 (PyPI ONLY) ===
      let license = info.license?.trim() || '';

      if (!license || license.toUpperCase() === 'UNKNOWN') {
        if (info.classifiers) {
          const licenses = info.classifiers.filter(c => c.startsWith('License ::'));
          if (licenses.length > 0) {
            const lastClassifier = licenses[licenses.length - 1];
            license = lastClassifier.split('::').pop().trim();
          }
        }
      }

      console.log(`📜 라이선스: ${license || '정보 없음'}`);

      if (!license) {
        console.log(`⚠️ [라이선스] 라이선스 정보가 부족합니다.`);
        hasIssue = true;
      } else if (bannedLicenses.some(bad => license.includes(bad))) {
        console.log(`❌ [라이선스] 금지된 라이선스가 포함되어 있습니다.`);
        hasIssue = true;
      } else {
        console.log(`✅ [라이선스] 문제가 없습니다.`);
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
