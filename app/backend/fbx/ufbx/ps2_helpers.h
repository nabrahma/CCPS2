// Flat accessors over ufbx for the Go read-back tests (PRD 6.3 step 3) and garment import (PRD F4).
// ufbx's unions and lists are awkward from cgo, so these copy what the tests
// compare into plain arrays.
#ifndef PS2_UFBX_HELPERS_H
#define PS2_UFBX_HELPERS_H
#include <stddef.h>
#include <stdint.h>
#include "ufbx.h"

ufbx_scene *ps2_load(const void *data, size_t size, char *err, size_t errlen);
/* For user files: lenient, and converted to metres, right-handed, Y up. */
ufbx_scene *ps2_load_garment(const void *data, size_t size, char *err, size_t errlen);

size_t ps2_warning_count(const ufbx_scene *s);
const char *ps2_warning(const ufbx_scene *s, size_t i);
double ps2_unit_meters(const ufbx_scene *s);
void ps2_axes(const ufbx_scene *s, int out[3]); /* right, up, front (ufbx_coordinate_axis) */

size_t ps2_node_count(const ufbx_scene *s);
const char *ps2_node_name(const ufbx_scene *s, size_t i);
int ps2_node_parent(const ufbx_scene *s, size_t i); /* index in scene->nodes, -1 for the root */
int ps2_node_is_bone(const ufbx_scene *s, size_t i);
int ps2_node_mesh(const ufbx_scene *s, size_t i);   /* index in scene->meshes or -1 */
void ps2_node_world(const ufbx_scene *s, size_t i, double out[16]);
void ps2_node_geometry_world(const ufbx_scene *s, size_t i, double out[16]);

size_t ps2_mesh_count(const ufbx_scene *s);
size_t ps2_mesh_num_vertices(const ufbx_scene *s, size_t m);
void ps2_mesh_vertices(const ufbx_scene *s, size_t m, double *out);
size_t ps2_mesh_num_faces(const ufbx_scene *s, size_t m);
int ps2_mesh_all_triangles(const ufbx_scene *s, size_t m);
void ps2_mesh_faces(const ufbx_scene *s, size_t m, uint32_t *begin, uint32_t *count);
size_t ps2_mesh_num_indices(const ufbx_scene *s, size_t m);
void ps2_mesh_indices(const ufbx_scene *s, size_t m, uint32_t *out);
int ps2_mesh_has_normals(const ufbx_scene *s, size_t m);
void ps2_mesh_normals(const ufbx_scene *s, size_t m, double *out); /* per index */
int ps2_mesh_has_uvs(const ufbx_scene *s, size_t m);
void ps2_mesh_uvs(const ufbx_scene *s, size_t m, double *out);     /* per index */
void ps2_mesh_face_materials(const ufbx_scene *s, size_t m, uint32_t *out);
size_t ps2_mesh_material_count(const ufbx_scene *s, size_t m);
const char *ps2_mesh_material_name(const ufbx_scene *s, size_t m, size_t k);
const char *ps2_mesh_material_texture(const ufbx_scene *s, size_t m, size_t k);

size_t ps2_skin_cluster_count(const ufbx_scene *s, size_t m);
const char *ps2_cluster_bone(const ufbx_scene *s, size_t m, size_t c);
size_t ps2_cluster_size(const ufbx_scene *s, size_t m, size_t c);
void ps2_cluster_data(const ufbx_scene *s, size_t m, size_t c, uint32_t *verts, double *weights);
void ps2_cluster_bind(const ufbx_scene *s, size_t m, size_t c, double out[16]);

size_t ps2_blend_channel_count(const ufbx_scene *s, size_t m);
const char *ps2_blend_channel_name(const ufbx_scene *s, size_t m, size_t c);
size_t ps2_blend_shape_size(const ufbx_scene *s, size_t m, size_t c);
void ps2_blend_shape_data(const ufbx_scene *s, size_t m, size_t c, uint32_t *idx, double *pos, double *nrm);

#endif
