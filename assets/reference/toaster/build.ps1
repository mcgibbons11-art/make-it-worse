# Author spec -> validate -> generate factory -> apply refine-code edits -> compile the
# preview harness -> render -> Tier 1 -> comparison sheet. Kept as one script because
# skipping the harness compile step silently renders stale JavaScript.
param(
  [Parameter(Mandatory = $true)][string]$PassId,
  [Parameter(Mandatory = $true)][string]$Label,
  [string[]]$Views = @("reference"),
  [switch]$SkipAuthor
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = (Resolve-Path (Join-Path $root "..\..\..")).Path
$skill = "C:\Users\Mcgib\.claude\skills\img2threejs"
$spec = Join-Path $root "toaster-sculpt-spec.json"
$model = Join-Path $project "components\game\models\createToasterModel.ts"
$reference = Join-Path $project "assets\reference\toaster-reference.png"

if (-not $SkipAuthor) {
  & python (Join-Path $root "author_toaster_spec.py") | Select-Object -Last 1
  Push-Location $skill
  & python "forge\stage2_spec\validate_sculpt_spec.py" $spec --strict-quality
  Pop-Location
}

Push-Location $skill
& python "forge\stage3_build\generate_threejs_factory.py" $spec --out $model --pass-id $PassId --force | Out-Null
Pop-Location
& python (Join-Path $root "apply_refinements.py")

Push-Location (Join-Path $root "preview")
& npx tsc -p tsconfig.json 2>&1 | Select-String " error TS"
& node shoot.mjs ../renders $Label @Views 2>&1 | Select-String "triangles|pageerror"
Pop-Location

$render = Join-Path $root "renders\$Label-reference.png"
Push-Location $skill
& python "forge\stage4_review\diagnose_render.py" --reference $reference --render $render --spec $spec --pass-id $PassId 2>&1 |
  Select-String "passed|silhouetteIoU|aspectRatioDelta|scaleDelta|maxDeltaE"
& python "forge\stage4_review\make_comparison_sheet.py" --reference $reference --render $render --out (Join-Path $root "renders\$Label-cmp.png") | Out-Null
Pop-Location
