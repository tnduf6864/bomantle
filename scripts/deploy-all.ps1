# 보맨틀 전체 배포 — 워커(API) → 웹 빌드 → Pages 순서.
#
# 순서가 중요하다: 웹을 먼저 올리면 클라가 새 games.json의 게임을 추천하는데 옛 워커는
# 그 id를 모른다(추측이 에러난다). 워커부터 올리면 그 반대는 안 생긴다 —
# 옛 클라가 아는 게임은 새 워커도 전부 안다.
#
# 예약 실행(무인)용이라 모든 출력을 deploy.log에 남기고 단계마다 종료 코드를 확인한다.
# wrangler는 이 PC에 캐시된 OAuth 토큰을 쓰므로 별도 인증이 필요 없다.
#
# 사용:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1 -DryRun   # 배포 없이 점검

param([switch]$DryRun)

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'deploy.log'
$apiBase = 'https://bomantle-api.bomantle.workers.dev'

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

# 네이티브 명령 실행 헬퍼.
#
# ⚠️ `$ErrorActionPreference='Stop'` 상태에서 네이티브 명령을 `2>&1`로 파이프하면
# Windows PowerShell 5.1은 stderr 한 줄 한 줄을 ErrorRecord로 만들어 **던진다**.
# wrangler는 정상 진행 상황도 stderr로 쓰기 때문에, 그대로 두면 배포가 잘 되는 중에
# 스크립트가 중단된다. 그래서 이 안에서만 Continue로 낮추고 성공 여부는
# 종료 코드로만 판단한다.
function Invoke-Native([string]$exe, [string[]]$argv, [string]$what) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $exe @argv 2>&1 | ForEach-Object { Log "  $_" }
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "$what 실패 (exit $code)" }
}

$ErrorActionPreference = 'Stop'
try {
    Log ('=== 배포 시작' + $(if ($DryRun) { ' (DryRun)' } else { '' }) + ' ===')

    # pnpm이 스크립트를 spawn할 때 node를 PATH에서 못 찾는 환경이 있어 직접 부른다.
    $wrangler = Join-Path $root 'workers\api\node_modules\wrangler\bin\wrangler.js'
    $next = Join-Path $root 'apps\web\node_modules\next\dist\bin\next'
    foreach ($p in @($wrangler, $next)) {
        if (-not (Test-Path $p)) { throw "필요한 파일 없음: $p (pnpm install 먼저)" }
    }

    # 1) 워커 — 엔진·힌트·정답 풀이 여기 들어 있다
    Log '워커 배포 중...'
    Push-Location (Join-Path $root 'workers\api')
    try {
        $a = @($wrangler, 'deploy')
        if ($DryRun) { $a += @('--dry-run', '--outdir', (Join-Path $env:TEMP 'bomantle-dry')) }
        Invoke-Native 'node' $a '워커 배포'
    }
    finally { Pop-Location }

    # 2) 웹 빌드 — 정적 export. API_BASE를 운영 워커로 고정해야 한다
    Log '웹 빌드 중...'
    Push-Location (Join-Path $root 'apps\web')
    try {
        $env:NEXT_PUBLIC_API_BASE = $apiBase
        Invoke-Native 'node' @($next, 'build') '웹 빌드'

        # 3) Pages — 프로덕션 브랜치가 main이라 이 배포가 곧장 apex에 반영된다
        if ($DryRun) {
            Log 'Pages 배포 생략 (DryRun)'
        }
        else {
            Log 'Pages 배포 중...'
            Invoke-Native 'node' @($wrangler, 'pages', 'deploy', 'out', '--project-name', 'bomantle') 'Pages 배포'
        }
    }
    finally { Pop-Location }

    Log '=== 배포 완료 ==='
    exit 0
}
catch {
    Log "!!! 실패: $_"
    exit 1
}
