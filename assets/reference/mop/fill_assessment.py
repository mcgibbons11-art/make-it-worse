#!/usr/bin/env python3
"""Fill the robot-mop pre-spec assessment from direct inspection of the reference.

new_pre_spec_assessment.py emits a scaffold with every judgement left unassessed.
This fills it with what the image actually shows. Every detail below was read off
assets/reference/mop-reference.png or one of the magnified crops in evidence/crops/,
and every mapsTo.ref matches a component/localFeature/material id authored in
author_mop_spec.py, because a detail that maps to nothing is a prose-only detail and
the strict-quality gate rejects it.

Deliberately absent: any detail of kind "gloss" or "fastener". The reference is matte
injection-moulded plastic with no visible hardware, and declaring either would force
the spec to carry a clearcoat or a fastener repetition system that the reference does
not show.

Run: python fill_assessment.py   (after new_pre_spec_assessment.py)
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSESSMENT = HERE / "assessment.json"


OBJECT_CLASS = {
    "primaryType": "household robotic floor-cleaning appliance (robot mop puck)",
    "primaryDomain": "object",
    "formLanguage": [
        "solid of revolution: circular plan, no D-front, no flat leading edge",
        "squat disc proportion, height roughly one fifth of diameter",
        "soft-product styling: every edge carries a generous fillet, no sharp arrises",
        "three-tone colour blocking (cream body, mint deck, navy bumper) with one coral accent",
    ],
    "structureKind": [
        "stacked horizontal layers around one vertical axis",
        "inset top deck recessed inside a raised cream rim lip",
        "applied outer band (navy bumper) standing proud of the shell wall",
        "peripheral repetition ring (microfibre tufts) hung under the shell",
    ],
    "motionPotential": [
        "whole-body translation across the floor (the trap patrols on a triangle wave)",
        "yaw spin about the vertical axis at the patrol turn",
        "counter-rotating brush ring under the base",
        "button depression along the deck normal",
    ],
    "materialFamilies": [
        "matte injection-moulded ABS (cream shell, mint deck, coral button)",
        "soft-touch matte elastomer (navy bumper band)",
        "flocked microfibre (pale grey fringe tufts)",
    ],
    "notes": (
        "Object, not character. Read from a single three-quarter-high studio render at "
        "elevation 29.5 degrees solved from the deck ellipse. No metal, glass, emissive or "
        "transmissive material anywhere in the reference."
    ),
}

COMPLEXITY = {
    "tier": "moderate",
    "scores": {
        # 0-3, the validator's rubric range. Justified in `reasoning` below.
        "silhouetteComplexity": 1,
        "componentCount": 2,
        "hierarchyDepth": 2,
        "repetitionDensity": 3,
        "materialLayerCount": 2,
        "localDetailDensity": 2,
        "occlusionRisk": 3,
        "actionReadinessNeed": 2,
    },
    "estimatedCounts": {
        "macroComponents": 2,
        "mesoComponents": 7,
        "microFeatureGroups": 4,
        "materialLayers": 5,
        "repetitionSystems": 2,
    },
    "reasoning": [
        "Silhouette is a simple disc, so silhouetteComplexity is low; the work is in the layering, not the outline.",
        "Two genuine repetition systems carry the identity: four navy bumper segments and a dense ring of microfibre tufts.",
        "Occlusion risk is high for a single view: the entire underside (wheels, brushes, tank) and the rear are invisible.",
        "Moderate rather than complex because there is no mechanism, linkage, or compound-curved organic form to reconstruct.",
    ],
}

SPEC_DEPTH = {
    "requiredDepth": "moderate",
    "minimumComponentLevels": ["macro", "meso", "micro"],
    "needsRepetitionSystems": True,
    "needsMaterialLocalOverrides": True,
    "needsMultipleReviewViews": True,
    "needsActionReadyHierarchy": True,
    "rationale": (
        "The bumper segments and the fringe tufts are both repetition systems and both are "
        "identity-defining, so a spec without repetition systems would be shallow. Local "
        "overrides are needed for the button's contact shadow and the occlusion under the rim "
        "overhang, which are shading facts rather than geometry. The prop is driven by a "
        "patrolling kinematic body and needs a spin pivot plus a brush-ring pivot."
    ),
}

UNKNOWNS: list[str] = []

# Kind must come from the validator's VALID_DETAIL_KINDS. Each ref is a component id,
# a component/localFeature pair, or a material/localOverride pair authored in the spec.
DETAILS = [
    {
        "id": "deck-rim-seam",
        "kind": "seam",
        "zone": "top-centre",
        "observation": (
            "A fine dark groove where the mint deck meets the cream rim, running the full "
            "circumference. The deck sits down inside the rim rather than flush with it."
        ),
        "measurement": "deck radius is 0.837 of the max radius, so the seam sits at 83.7 percent of the plan",
        "mapsTo": {"ref": "deck-plate/deck-rim-seam", "kind": "component.localFeatures"},
    },
    {
        "id": "rim-inner-lip",
        "kind": "ridge",
        "zone": "top-perimeter",
        "observation": (
            "The cream rim rises above the mint deck as a raised lip, so the deck reads as "
            "recessed. Visible as a bright crown line along the far rim in the reference."
        ),
        "measurement": "lip stands a few pixels above the deck plane at the far edge (screen rows 421-433)",
        "mapsTo": {"ref": "shell-rim/rim-inner-lip", "kind": "component.localFeatures"},
    },
    {
        "id": "button-edge-fillet",
        "kind": "bevel",
        "zone": "top-centre",
        "observation": (
            "The coral button's top face meets its side wall through a soft fillet, not a sharp "
            "edge; the fillet catches a light band around the upper rim of the button."
        ),
        "measurement": "button crop shows the fillet occupying roughly a sixth of the button's visible height",
        "mapsTo": {"ref": "power-button/button-edge-fillet", "kind": "component.localFeatures"},
    },
    {
        "id": "button-recess-ring",
        "kind": "contour",
        "zone": "top-centre",
        "observation": (
            "The button's side wall is slightly wider at the top than the bottom, so it reads as "
            "seated in a shallow recess rather than stuck onto the deck."
        ),
        "measurement": "side wall tapers inward toward the deck by a small amount in the 3x button crop",
        "mapsTo": {"ref": "power-button/button-recess-ring", "kind": "component.localFeatures"},
    },
    {
        "id": "button-contact-shadow",
        "kind": "contour",
        "zone": "top-centre",
        "observation": (
            "A tight dark occlusion arc on the mint deck hugging the button's base, strongest at "
            "the left and right where the deck curves away from the key light."
        ),
        "measurement": "visible as a 2-4px dark rim in the 3x button crop",
        "mapsTo": {"ref": "deck-mint/button-contact-shadow", "kind": "material.localOverrides"},
    },
    {
        "id": "segment-gap",
        "kind": "groove",
        "zone": "side-band",
        "observation": (
            "The navy bumper is not a continuous ring: narrow cream slots separate it into "
            "segments. Two gaps are directly visible on the front-facing half."
        ),
        "measurement": "gap width is roughly one eighth of a segment's vertical thickness",
        "mapsTo": {"ref": "bumper-band/segment-gap", "kind": "component.localFeatures"},
    },
    {
        "id": "segment-end-cap",
        "kind": "bevel",
        "zone": "side-band",
        "observation": (
            "Each navy segment terminates in a generously rounded end cap rather than a square "
            "cut, clearly resolved in the 2x left-gap crop."
        ),
        "measurement": "end-cap fillet radius is close to half the segment's vertical thickness",
        "mapsTo": {"ref": "bumper-band/segment-end-cap", "kind": "component.localFeatures"},
    },
    {
        "id": "segment-standoff",
        "kind": "ridge",
        "zone": "side-band",
        "observation": (
            "The navy band stands proud of the cream wall behind it, casting its own soft shadow "
            "onto the shell. It is an applied bumper, not a painted stripe."
        ),
        "measurement": "the max silhouette radius occurs at the navy band, outside the cream shell's radius",
        "mapsTo": {"ref": "bumper-band/segment-standoff", "kind": "component.localFeatures"},
    },
    {
        "id": "recess-outline",
        "kind": "groove",
        "zone": "front-lower",
        "observation": (
            "A stadium-shaped recessed panel centred on the front of the lower cream shell, "
            "reading as a tank or dustbin release."
        ),
        "measurement": "roughly 240x70 source pixels, centred on the object's front centreline",
        "mapsTo": {"ref": "latch-recess/recess-outline", "kind": "component.localFeatures"},
    },
    {
        "id": "recess-chamfer",
        "kind": "bevel",
        "zone": "front-lower",
        "observation": (
            "The recess is let into the shell through a soft chamfer, with a darker band along "
            "its upper edge where the shell overhangs it."
        ),
        "measurement": "chamfer and its shadow are resolved in the 3x latch-tab crop",
        "mapsTo": {"ref": "latch-recess/recess-chamfer", "kind": "component.localFeatures"},
    },
    {
        "id": "tuft-scallop",
        "kind": "contour",
        "zone": "underside-perimeter",
        "observation": (
            "The fringe reads as individual rounded tufts, giving the bottom of the silhouette a "
            "scalloped rather than a smooth outline. This is what makes it a mop and not a vacuum."
        ),
        "measurement": "tufts are 12-16 source pixels across; the fringe reaches 11px beyond the cream shell radius",
        "mapsTo": {"ref": "fringe-skirt/tuft-scallop", "kind": "component.localFeatures"},
    },
    {
        "id": "tuft-row-stagger",
        "kind": "contour",
        "zone": "underside-perimeter",
        "observation": (
            "The tufts sit in two staggered rows, so the lower row shows through the gaps in the "
            "upper one and the band reads as dense rather than as a single picket line."
        ),
        "measurement": "two overlapping rows resolved in the 2x fringe-bottom crop",
        "mapsTo": {"ref": "fringe-skirt/tuft-row-stagger", "kind": "component.localFeatures"},
    },
    {
        "id": "wall-taper",
        "kind": "contour",
        "zone": "side-lower",
        "observation": (
            "Below the navy band the cream wall draws inward toward the base, so the puck is "
            "widest at the bumper and narrower where it meets the floor."
        ),
        "measurement": "silhouette half-width falls from 470px at the band to roughly 440px near the base",
        "mapsTo": {"ref": "shell-body/wall-taper", "kind": "component.localFeatures"},
    },
    {
        "id": "under-rim-occlusion",
        "kind": "contour",
        "zone": "side-upper",
        "observation": (
            "A soft darkening on the cream wall directly beneath the rim's overhang and inside "
            "each bumper gap, from contact occlusion rather than from a change of colour."
        ),
        "measurement": "cream under the rim reads 12-18 levels darker than the lit rim crown",
        "mapsTo": {"ref": "shell-cream/under-rim-occlusion", "kind": "material.localOverrides"},
    },
]


def main() -> None:
    document = json.loads(ASSESSMENT.read_text(encoding="utf-8"))
    assessment = document["preSpecAssessment"]
    assessment["objectClass"] = OBJECT_CLASS
    assessment["complexity"] = COMPLEXITY
    assessment["specDepthDecision"] = SPEC_DEPTH
    assessment["unknownsToResolveBeforeImplementation"] = UNKNOWNS
    inventory = assessment["detailInventory"]
    inventory["scanMethod"] = "component-zones plus magnified crops (evidence/crops)"
    inventory["details"] = DETAILS
    inventory["note"] = (
        "Enumerated from the reference and the magnified crops. No gloss detail is listed "
        "because the reference is uniformly matte, and no fastener detail because no hardware "
        "is visible; declaring either would force material or repetition behaviour the "
        "reference does not support."
    )
    ASSESSMENT.write_text(json.dumps(document, indent=2), encoding="utf-8")
    print(f"details={len(DETAILS)} target={inventory['targetMinDetails']}")
    print(f"wrote {ASSESSMENT}")


if __name__ == "__main__":
    main()
