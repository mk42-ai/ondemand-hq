# arjun988_blender-skills → MCP Tool Mapping

> **⚠️ Honesty note on provenance.** The upstream `arjun988_blender-skills` pack manifest could **not** be retrieved in this session — a file/directory search for it returned only unrelated documents, and no other tool available in this environment could fetch the real pack. Nothing in this document is a verbatim quote of that pack. The 94 rows below are a **derived, canonical reconstruction** of the Blender skill surface that a 94-skill pack of this kind would plausibly cover, organized by the domains named in the task brief. The **MCP-tool binding for each row is authoritative for THIS server** — it reflects the real, fixed set of 14 tools exposed by `ondemand-blender-mcp` and how each class of operation would necessarily have to route through them. The **skill *names*, however, are illustrative reconstructions** and MUST be reconciled against the real `arjun988_blender-skills` pack (exact skill IDs/names) before this document is treated as a definitive, publishable mapping.

## How to read this table

- **Primary MCP tool** — the single MCP tool that actually performs the skill's core work.
- **Supporting tools** — tools typically invoked immediately before or after the primary tool within the same skill, most often `get_scene_info` / `get_object_info` to inspect state beforehand and `get_viewport_screenshot` to verify the result afterward. An em dash (—) means the skill is normally self-contained and calls no supporting tool.
- **`execute_blender_code` as Primary** means *Fallback*: no first-class tool among the 14 covers that operation, so the skill has to drop down to raw `bpy` scripting through `execute_blender_code`. Every such row says so explicitly in its Notes, and the pattern is analyzed in the Gap analysis section at the end.

## Skill → tool mapping

| # | Skill | Domain | Primary MCP tool | Supporting tools | Notes |
|---|-------|--------|-------------------|-------------------|-------|
| 1 | list_scene_objects | Scene & Inspection | get_scene_info | — | Enumerates all objects, collections, and counts in the scene |
| 2 | inspect_object_transform | Scene & Inspection | get_object_info | get_scene_info | Reads an object's location, rotation, and scale |
| 3 | inspect_object_hierarchy | Scene & Inspection | get_scene_info | get_object_info | Walks parent/child relationships for a target object |
| 4 | inspect_material_slots | Scene & Inspection | get_object_info | — | Lists material slots and assigned shaders on an object |
| 5 | inspect_modifier_stack | Scene & Inspection | get_object_info | — | Reports modifier order/params without changing them |
| 6 | audit_scene_statistics | Scene & Inspection | get_scene_info | — | Tallies polycount, object count, memory for scene health |
| 7 | capture_viewport_reference | Scene & Inspection | get_viewport_screenshot | get_scene_info | Grabs a reference image of the current viewport state |
| 8 | diff_scene_before_after | Scene & Inspection | get_scene_info | get_viewport_screenshot | Compares two scene snapshots to confirm an edit's effect |
| 9 | create_primitive_cube | Object Creation | create_object | get_scene_info | Spawns a cube mesh at a given location and size |
| 10 | create_primitive_sphere | Object Creation | create_object | get_scene_info | Spawns a UV or ico sphere primitive |
| 11 | create_primitive_cylinder | Object Creation | create_object | — | Adds a cylinder with configurable radius and depth |
| 12 | create_primitive_cone | Object Creation | create_object | — | Adds a cone primitive for blockout shapes |
| 13 | create_primitive_torus | Object Creation | create_object | — | Adds a torus for donut or ring geometry |
| 14 | create_primitive_plane | Object Creation | create_object | — | Adds a flat plane, commonly ground or backdrop |
| 15 | create_empty_axes | Object Creation | create_object | — | Adds an Empty used as a parent or locator null |
| 16 | create_camera_object | Object Creation | create_object | get_viewport_screenshot | Adds a new camera data-block and object |
| 17 | create_light_object | Object Creation | create_object | — | Adds a generic light object before type-specific tuning |
| 18 | create_text_object | Object Creation | create_object | — | Adds a 3D text object from a string |
| 19 | create_curve_bezier | Object Creation | create_object | — | Adds a Bezier curve for paths or cable shapes |
| 20 | delete_selected_object | Object Creation | delete_object | get_scene_info | Removes a named object cleanly from the scene |
| 21 | translate_object_position | Transforms & Modifiers | modify_object | get_object_info | Sets an object's absolute XYZ location |
| 22 | rotate_object_euler | Transforms & Modifiers | modify_object | get_object_info | Sets rotation in Euler degrees per axis |
| 23 | scale_object_uniform | Transforms & Modifiers | modify_object | get_object_info | Applies a single uniform scale factor |
| 24 | rename_object | Transforms & Modifiers | modify_object | get_scene_info | Renames the object data-block for clarity |
| 25 | set_object_visibility | Transforms & Modifiers | modify_object | get_scene_info | Toggles render and viewport visibility flags |
| 26 | parent_object_to_target | Transforms & Modifiers | execute_blender_code | get_scene_info | Fallback: parenting API has no first-class tool |
| 27 | apply_subdivision_modifier | Transforms & Modifiers | execute_blender_code | get_viewport_screenshot | Fallback: modifier stack is not exposed as a tool |
| 28 | apply_bevel_modifier | Transforms & Modifiers | execute_blender_code | get_viewport_screenshot | Fallback: bevel modifier needs a raw bpy call |
| 29 | apply_boolean_modifier | Transforms & Modifiers | execute_blender_code | get_object_info | Fallback: boolean op needs a two-object modifier setup |
| 30 | apply_array_modifier | Transforms & Modifiers | execute_blender_code | get_viewport_screenshot | Fallback: array modifier params unavailable as a tool |
| 31 | apply_mirror_modifier | Transforms & Modifiers | execute_blender_code | get_viewport_screenshot | Fallback: mirror modifier has no dedicated tool |
| 32 | apply_solidify_modifier | Transforms & Modifiers | execute_blender_code | get_viewport_screenshot | Fallback: solidify modifier has no dedicated tool |
| 33 | set_pbr_metal_material | Materials & Shading | set_material | get_object_info | Assigns a metallic PBR material preset |
| 34 | set_diffuse_color_material | Materials & Shading | set_material | — | Sets a flat base-color diffuse material |
| 35 | set_glass_material | Materials & Shading | set_material | get_viewport_screenshot | Applies a transmissive glass shader preset |
| 36 | set_emission_material | Materials & Shading | set_material | — | Sets an emissive glowing material and its strength |
| 37 | assign_material_to_object | Materials & Shading | set_material | get_scene_info | Binds an existing material to a target object's slot |
| 38 | set_roughness_value | Materials & Shading | set_material | get_object_info | Adjusts surface roughness on the active material |
| 39 | set_material_transparency | Materials & Shading | set_material | — | Sets alpha and blend mode for see-through surfaces |
| 40 | copy_material_between_objects | Materials & Shading | set_material | get_object_info | Duplicates one object's material onto another |
| 41 | create_procedural_noise_texture | Materials & Shading | execute_blender_code | get_viewport_screenshot | Fallback: procedural node graphs need raw bpy |
| 42 | build_custom_shader_node_graph | Materials & Shading | execute_blender_code | get_object_info | Fallback: arbitrary node trees exceed set_material's scope |
| 43 | set_uv_mapped_image_texture | Materials & Shading | execute_blender_code | get_viewport_screenshot | Fallback: UV plus image-texture nodes need scripting |
| 44 | set_subsurface_scattering_skin | Materials & Shading | execute_blender_code | get_viewport_screenshot | Fallback: SSS node setup is not a first-class parameter |
| 45 | add_point_light | Lighting | create_object | — | Adds an omnidirectional point light |
| 46 | add_sun_light | Lighting | create_object | — | Adds a directional sun light for outdoor scenes |
| 47 | add_area_light | Lighting | create_object | — | Adds a soft-shadow rectangular area light |
| 48 | add_spot_light | Lighting | create_object | — | Adds a cone-shaped spot light |
| 49 | add_three_point_lighting | Lighting | create_object | get_viewport_screenshot | Creates key, fill, and rim lights in one pass |
| 50 | set_light_energy_intensity | Lighting | modify_object | get_object_info | Tunes wattage/strength on an existing light object |
| 51 | set_light_color_temperature | Lighting | modify_object | get_object_info | Adjusts a light's color or Kelvin value |
| 52 | add_hdri_environment_lighting | Lighting | poly_haven_download | poly_haven_search, get_viewport_screenshot | Pulls an HDRI to light the whole scene |
| 53 | aim_camera_at_target | Camera & Composition | modify_object | get_object_info | Rotates the camera to point at a target object |
| 54 | frame_object_in_camera | Camera & Composition | modify_object | get_object_info, get_viewport_screenshot | Positions the camera so a target fills the frame |
| 55 | set_camera_focal_length | Camera & Composition | execute_blender_code | get_object_info | Fallback: camera-data lens property is unexposed |
| 56 | set_camera_depth_of_field | Camera & Composition | execute_blender_code | get_viewport_screenshot | Fallback: DOF/f-stop settings need raw bpy |
| 57 | set_camera_clipping_planes | Camera & Composition | execute_blender_code | — | Fallback: clip start/end are camera-data only |
| 58 | animate_camera_orbit_path | Camera & Composition | execute_blender_code | get_viewport_screenshot | Fallback: keyframed orbit needs scripted animation |
| 59 | verify_composition_rule_of_thirds | Camera & Composition | get_viewport_screenshot | get_object_info | Captures the frame to visually check composition guides |
| 60 | search_polyhaven_assets | Asset Import/Library | poly_haven_search | — | Queries the Poly Haven catalog by keyword or type |
| 61 | browse_polyhaven_categories | Asset Import/Library | poly_haven_search | — | Lists available asset categories before downloading |
| 62 | import_polyhaven_hdri | Asset Import/Library | poly_haven_download | poly_haven_search | Downloads and links an HDRI world texture |
| 63 | import_polyhaven_texture_set | Asset Import/Library | poly_haven_download | poly_haven_search, set_material | Downloads a full PBR texture set for a material |
| 64 | import_polyhaven_model | Asset Import/Library | poly_haven_download | poly_haven_search, get_scene_info | Downloads a ready-made model asset into the scene |
| 65 | search_sketchfab_models | Asset Import/Library | sketchfab_search | — | Queries Sketchfab by keyword |
| 66 | search_sketchfab_by_category | Asset Import/Library | sketchfab_search | — | Filters Sketchfab results by category or license |
| 67 | import_sketchfab_model | Asset Import/Library | sketchfab_download | sketchfab_search, get_scene_info | Downloads and imports a chosen Sketchfab model |
| 68 | import_sketchfab_scanned_prop | Asset Import/Library | sketchfab_download | sketchfab_search | Imports a photogrammetry-scanned prop asset |
| 69 | import_reference_asset_bundle | Asset Import/Library | sketchfab_download | sketchfab_search, get_viewport_screenshot | Pulls a reference asset for scale or lookdev matching |
| 70 | generate_model_from_text | Generative 3D | hyper3d_generate_model | get_scene_info | Text-prompt to 3D mesh generation |
| 71 | generate_model_from_image | Generative 3D | hyper3d_generate_model | get_viewport_screenshot | Image-to-3D single-view reconstruction |
| 72 | generate_stylized_asset_hunyuan | Generative 3D | hunyuan3d_generate_model | get_scene_info | Generates a stylized asset via Hunyuan3D |
| 73 | generate_character_mesh_hunyuan | Generative 3D | hunyuan3d_generate_model | get_viewport_screenshot | Generates a character base mesh from a prompt |
| 74 | refine_generated_mesh_topology | Generative 3D | execute_blender_code | get_object_info | Fallback: retopology/cleanup script after generation |
| 75 | import_generated_model_into_scene | Generative 3D | create_object | get_scene_info | Places a returned generative asset into the scene graph |
| 76 | render_still_png | Rendering & Output | execute_blender_code | get_viewport_screenshot | Fallback: no dedicated render tool exists |
| 77 | render_animation_sequence | Rendering & Output | execute_blender_code | get_scene_info | Fallback: frame-range render loop needs scripting |
| 78 | set_render_resolution | Rendering & Output | execute_blender_code | — | Fallback: render-settings block is unexposed |
| 79 | set_render_engine_cycles_eevee | Rendering & Output | execute_blender_code | — | Fallback: engine switch is a scene-settings write |
| 80 | set_output_file_format | Rendering & Output | execute_blender_code | — | Fallback: output path/format is not a first-class param |
| 81 | configure_compositor_nodes | Rendering & Output | execute_blender_code | get_viewport_screenshot | Fallback: compositor node tree needs raw bpy |
| 82 | batch_render_camera_views | Rendering & Output | execute_blender_code | get_scene_info | Fallback: multi-camera batch loop requires scripting |
| 83 | preview_viewport_snapshot | Rendering & Output | get_viewport_screenshot | — | Quick non-final preview substitute for a real render |
| 84 | insert_keyframe_location | Animation & Rigging | execute_blender_code | get_object_info | Fallback: keyframing API has no dedicated tool |
| 85 | insert_keyframe_rotation | Animation & Rigging | execute_blender_code | get_object_info | Fallback: rotation keyframes need a scripted insert |
| 86 | set_animation_frame_range | Animation & Rigging | execute_blender_code | get_scene_info | Fallback: scene frame_start/end are unexposed |
| 87 | create_armature_rig | Animation & Rigging | execute_blender_code | get_scene_info | Fallback: armature creation has no first-class tool |
| 88 | bind_mesh_to_armature | Animation & Rigging | execute_blender_code | get_object_info | Fallback: skinning and weights require raw bpy |
| 89 | add_shape_key_morph | Animation & Rigging | execute_blender_code | get_object_info | Fallback: shape keys are not a modeled tool parameter |
| 90 | bake_action_to_nla_track | Animation & Rigging | execute_blender_code | get_scene_info | Fallback: NLA baking needs a scripted action |
| 91 | bevel_mesh_edges | Geometry/Mesh Editing | execute_blender_code | get_viewport_screenshot | Fallback: edit-mode edge bevel needs raw bpy |
| 92 | extrude_mesh_faces | Geometry/Mesh Editing | execute_blender_code | get_viewport_screenshot | Fallback: face extrusion is an edit-mode operation |
| 93 | merge_vertices_by_distance | Geometry/Mesh Editing | execute_blender_code | get_object_info | Fallback: vertex merge is mesh-data level |
| 94 | delete_mesh_selection | Geometry/Mesh Editing | execute_blender_code | get_object_info | Fallback: sub-object deletion differs from delete_object |

## Coverage summary

| MCP tool | # skills bound as primary | % of 94 |
|---|---|---|
| execute_blender_code | 34 | 36.2% |
| create_object | 17 | 18.1% |
| modify_object | 9 | 9.6% |
| set_material | 8 | 8.5% |
| get_scene_info | 4 | 4.3% |
| poly_haven_download | 4 | 4.3% |
| get_object_info | 3 | 3.2% |
| get_viewport_screenshot | 3 | 3.2% |
| sketchfab_download | 3 | 3.2% |
| poly_haven_search | 2 | 2.1% |
| sketchfab_search | 2 | 2.1% |
| hyper3d_generate_model | 2 | 2.1% |
| hunyuan3d_generate_model | 2 | 2.1% |
| delete_object | 1 | 1.1% |

## Gap analysis

- **Animation & Rigging has zero first-class coverage.** Keyframing, armature creation, skinning, shape keys, and NLA baking (all 7 skills in this domain) fall back to `execute_blender_code` — there is no `insert_keyframe`, `create_armature`, or `bind_skin` tool, so raw scripting is the *only* way to animate anything.
- **Modifier-stack operations have no dedicated tool.** `modify_object` only reaches object-level transform, name, and visibility, not the modifier stack — so 7 of the 12 Transforms & Modifiers skills (subdivision, bevel, boolean, array, mirror, solidify, plus parenting) drop to `execute_blender_code`.
- **Mesh/edit-mode geometry editing is entirely uncovered.** `delete_object` removes whole objects, not sub-object geometry, and there is no bevel/extrude/merge tool — all 4 Geometry/Mesh Editing skills require raw `bpy` in edit mode.
- **Render settings and output have no tool at all.** Resolution, engine choice, file format, compositor nodes, and the actual render trigger are not modeled as tools — 7 of the 8 Rendering & Output skills fall back, meaning no final image or animation can be produced without arbitrary code execution.
- **Camera data-block properties sit outside `modify_object`'s reach.** Focal length, depth of field, and clip planes live on the camera *data* block, not the object transform `modify_object` covers — over half of Camera & Composition falls back for anything beyond aim/position.
- **Advanced shading exceeds `set_material`'s flat-parameter model.** Procedural textures, custom node graphs, UV-mapped image textures, and subsurface scattering need real node-tree construction, pushing a third of Materials & Shading to `execute_blender_code`.
- **Security consequence:** because five whole domains (animation/rigging, modifiers, mesh-edit, render/compositor, advanced shading/camera data) can *only* be reached through `execute_blender_code`, that single tool — full arbitrary code execution inside the Blender process — can never be disabled or sandboxed away without breaking 36.2% of the pack's skills. It is simultaneously the server's most dangerous tool and its most load-bearing one.
- **Prioritization for a future version:** these fallback-heavy domains are the correct place to invest in new first-class tools (e.g. `apply_modifier`, `insert_keyframe`, `set_render_settings`, `edit_mesh`, `set_camera_data`) *before* attempting to restrict `execute_blender_code` itself — narrowing its footprint domain-by-domain is what will actually let it be gated safely.
