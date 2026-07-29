# Append one sculpt-pass review. append_review.py takes one value per flag, so list
# arguments are expanded here rather than inline at every call site.
param(
  [Parameter(Mandatory = $true)][string]$PassId,
  [Parameter(Mandatory = $true)][double]$Fidelity,
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][string]$Summary,
  [string[]]$Matched = @(),
  [string[]]$Mismatches = @(),
  [string[]]$SpecFixes = @(),
  [string[]]$CodeFixes = @(),
  [string[]]$Evidence = @(),
  [Parameter(Mandatory = $true)][string]$Render,
  [Parameter(Mandatory = $true)][string]$Comparison,
  [Parameter(Mandatory = $true)][double]$AiScore,
  [Parameter(Mandatory = $true)][string]$LayerScores,
  [string]$FeatureReviews = "",
  [string]$Notes = "",
  [string]$MapStrippedRender = "",
  [string]$CameraView = "reference-three-quarter (azimuth 41, elevation 19)"
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = (Resolve-Path (Join-Path $root "..\..\..")).Path
$spec = Join-Path $root "toaster-sculpt-spec.json"
$reference = Join-Path $project "assets\reference\toaster-reference.png"
$skill = "C:\Users\Mcgib\.claude\skills\img2threejs"

# Inline JSON does not survive the PowerShell to python argument hand-off, so the layer
# scores go through a file.
$layerScoresFile = Join-Path $root "renders\layers-$PassId.json"
[System.IO.File]::WriteAllText($layerScoresFile, $LayerScores, (New-Object System.Text.UTF8Encoding $false))

$argv = @(
  (Join-Path $skill "forge\stage4_review\append_review.py"), $spec,
  "--pass-id", $PassId, "--fidelity", $Fidelity, "--action", $Action, "--summary", $Summary,
  "--reference-screenshot", $reference, "--render-screenshot", $Render,
  "--comparison-image", $Comparison, "--ai-vision-score", $AiScore,
  "--visual-threshold", 0.7, "--camera-view", $CameraView,
  "--layer-scores-json", $layerScoresFile
)
foreach ($item in $Matched) { $argv += @("--matched", $item) }
foreach ($item in $Mismatches) { $argv += @("--mismatches", $item) }
foreach ($item in $SpecFixes) { $argv += @("--spec-fixes", $item) }
foreach ($item in $CodeFixes) { $argv += @("--code-fixes", $item) }
foreach ($item in $Evidence) { $argv += @("--evidence", $item) }
if ($FeatureReviews) { $argv += @("--feature-reviews-json", $FeatureReviews) }
if ($Notes) { $argv += @("--ai-vision-notes", $Notes) }
if ($MapStrippedRender) { $argv += @("--map-stripped-render", $MapStrippedRender) }
$argv += "--in-place"

Push-Location $skill
& python @argv
Pop-Location
