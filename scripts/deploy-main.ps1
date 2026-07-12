<#
.SYNOPSIS
  YeaeunnKim/snail_beta_test_web main을 snail8/glamnowlab Vercel production으로 배포한다.

.DESCRIPTION
  개인 작업 트리나 현재 브랜치를 직접 배포하지 않는다. 항상 GitHub 원격 main을 임시 폴더에
  shallow clone한 뒤, 고정 Vercel org/project id로 배포한다.

  이 방식은 다음 실수를 막는다.
  - feature 브랜치나 미커밋 로컬 변경을 production에 배포
  - 잘못된 Vercel 프로젝트/alias로 배포
  - Vercel 팀 author 체크로 배포가 막히거나 다른 배포 표면이 생김

.PARAMETER Preview
  production 대신 preview 배포를 만든다.

.PARAMETER DryRun
  Vercel 배포를 실행하지 않고 계정, clone, 대상 SHA, 고정 project id만 확인한다.
#>
param(
  [switch]$Preview,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$Repo = 'https://github.com/YeaeunnKim/snail_beta_test_web.git'
$Branch = 'main'
$OrgId = 'team_ci4nDCjH1ZYNSIfFMot4Cibr'      # Vercel team: snail8 / glamnowlab
$ProjectId = 'prj_zOnsvz7NMAHL7mSvCKwKk8NDMGLi' # Vercel project: snail_beta_test_web

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git CLI가 필요합니다.'
}
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  throw 'Vercel CLI가 필요합니다. `npm i -g vercel` 후 glamnowlab 계정으로 `vercel login` 하세요.'
}

$whoOutput = & cmd /c "vercel whoami 2>&1"
if ($LASTEXITCODE -ne 0) {
  throw "vercel whoami failed: $($whoOutput -join ' ')"
}
$who = ($whoOutput | Select-Object -Last 1).Trim()
Write-Host "Vercel account: $who"
if ($who -notmatch 'glamnowlab') {
  Write-Warning '현재 Vercel 계정이 glamnowlab 계정으로 보이지 않습니다. 배포 권한과 scope를 확인하세요.'
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("snail-beta-main-" + [guid]::NewGuid().ToString('N'))
Write-Host "Cloning $Repo#$Branch -> $work"
git clone --quiet --depth 1 --branch $Branch $Repo $work
if ($LASTEXITCODE -ne 0) {
  throw "git clone failed for $Repo#$Branch"
}

try {
  $sha = (git -C $work rev-parse HEAD).Trim()
  $shortSha = $sha.Substring(0, 7)

  $env:VERCEL_ORG_ID = $OrgId
  $env:VERCEL_PROJECT_ID = $ProjectId

  if ($DryRun) {
    Write-Host "Dry run OK: YeaeunnKim/snail_beta_test_web@$shortSha -> snail8/snail_beta_test_web"
    return
  }

  Remove-Item -Recurse -Force (Join-Path $work '.git')

  Push-Location $work
  try {
    $target = if ($Preview) { 'preview' } else { 'production' }
    Write-Host "Deploying YeaeunnKim/snail_beta_test_web@$shortSha -> snail8/snail_beta_test_web ($target)"
    $args = @(
      'deploy',
      '--yes',
      '--meta', 'source=YeaeunnKim/snail_beta_test_web:main',
      '--meta', "gitSha=$sha"
    )
    if (-not $Preview) {
      $args += '--prod'
    }
    & vercel @args
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
