param(
    [Parameter(Mandatory = $true)]
    [string]$Account,
    [string]$AccountName,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Slug {
    param([Parameter(Mandatory = $true)][string]$Text)

    $slug = $Text.ToLowerInvariant()
    $slug = [regex]::Replace($slug, "[^a-z0-9]+", "-")
    $slug = [regex]::Replace($slug, "-{2,}", "-").Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) {
        throw "Unable to derive a valid account slug from input: $Text"
    }
    return $slug
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$accountSlug = Get-Slug $Account
$displayName = if ([string]::IsNullOrWhiteSpace($AccountName)) { $Account } else { $AccountName.Trim() }

$accountDir = Join-Path $repoRoot ("accounts\" + $accountSlug)
New-Item -ItemType Directory -Path $accountDir -Force | Out-Null

$subfolders = @("meetings", "notes", "questions", "demos", "scenarios", "architecture", "artifacts")
foreach ($folder in $subfolders) {
    New-Item -ItemType Directory -Path (Join-Path $accountDir $folder) -Force | Out-Null
}

$questionsTemplate = Join-Path $repoRoot "_templates\questions.md"
$questionsPath = Join-Path $accountDir "questions\questions.md"
if ((Test-Path $questionsTemplate -PathType Leaf) -and (-not (Test-Path $questionsPath -PathType Leaf) -or $Force)) {
    Copy-Item -Path $questionsTemplate -Destination $questionsPath -Force
}

$discoveryTemplate = Join-Path $repoRoot "_templates\discovery.md"
$discoveryPath = Join-Path $accountDir "notes\discovery-framework.md"
if ((Test-Path $discoveryTemplate -PathType Leaf) -and (-not (Test-Path $discoveryPath -PathType Leaf) -or $Force)) {
    Copy-Item -Path $discoveryTemplate -Destination $discoveryPath -Force
}

$templatePath = Join-Path $repoRoot "_templates\account-readme.md"
if (-not (Test-Path $templatePath -PathType Leaf)) {
    throw "Template not found: $templatePath"
}

$readmePath = Join-Path $accountDir "README.md"
if ((Test-Path $readmePath -PathType Leaf) -and (-not $Force)) {
    Write-Output "Account already exists. Skipping README overwrite: $readmePath"
}
else {
    $templateContent = Get-Content -Path $templatePath -Raw -Encoding UTF8
    $content = $templateContent.Replace("<Account Name>", $displayName)
    Set-Content -Path $readmePath -Value $content -Encoding UTF8
}

Write-Output "Account scaffold ready: $accountDir"
Write-Output "README: $readmePath"
