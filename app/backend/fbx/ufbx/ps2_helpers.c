#include <string.h>
#include "ps2_helpers.h"

ufbx_scene *ps2_load(const void *data, size_t size, char *err, size_t errlen) {
	ufbx_load_opts opts;
	memset(&opts, 0, sizeof(opts));
	opts.strict = true; /* fail on malformed data instead of guessing */
	ufbx_error error;
	ufbx_scene *scene = ufbx_load_memory(data, size, &opts, &error);
	if (!scene && err && errlen) ufbx_format_error(err, errlen, &error);
	return scene;
}

ufbx_scene *ps2_load_garment(const void *data, size_t size, char *err, size_t errlen) {
	ufbx_load_opts opts;
	memset(&opts, 0, sizeof(opts));
	opts.target_axes = ufbx_axes_right_handed_y_up;
	opts.target_unit_meters = 1.0;
	ufbx_error error;
	ufbx_scene *scene = ufbx_load_memory(data, size, &opts, &error);
	if (!scene && err && errlen) ufbx_format_error(err, errlen, &error);
	return scene;
}

size_t ps2_warning_count(const ufbx_scene *s) { return s->metadata.warnings.count; }
const char *ps2_warning(const ufbx_scene *s, size_t i) { return s->metadata.warnings.data[i].description.data; }
double ps2_unit_meters(const ufbx_scene *s) { return s->settings.unit_meters; }
void ps2_axes(const ufbx_scene *s, int out[3]) {
	out[0] = (int)s->settings.axes.right;
	out[1] = (int)s->settings.axes.up;
	out[2] = (int)s->settings.axes.front;
}

static void matrix16(const ufbx_matrix *m, double out[16]) {
	out[0] = m->m00; out[1] = m->m10; out[2] = m->m20; out[3] = 0;
	out[4] = m->m01; out[5] = m->m11; out[6] = m->m21; out[7] = 0;
	out[8] = m->m02; out[9] = m->m12; out[10] = m->m22; out[11] = 0;
	out[12] = m->m03; out[13] = m->m13; out[14] = m->m23; out[15] = 1;
}

size_t ps2_node_count(const ufbx_scene *s) { return s->nodes.count; }
const char *ps2_node_name(const ufbx_scene *s, size_t i) { return s->nodes.data[i]->name.data; }
int ps2_node_parent(const ufbx_scene *s, size_t i) {
	const ufbx_node *p = s->nodes.data[i]->parent;
	return p ? (int)p->typed_id : -1;
}
int ps2_node_is_bone(const ufbx_scene *s, size_t i) { return s->nodes.data[i]->bone != NULL; }
int ps2_node_mesh(const ufbx_scene *s, size_t i) {
	const ufbx_mesh *m = s->nodes.data[i]->mesh;
	return m ? (int)m->typed_id : -1;
}
void ps2_node_world(const ufbx_scene *s, size_t i, double out[16]) { matrix16(&s->nodes.data[i]->node_to_world, out); }

void ps2_node_geometry_world(const ufbx_scene *s, size_t i, double out[16]) { matrix16(&s->nodes.data[i]->geometry_to_world, out); }

size_t ps2_mesh_count(const ufbx_scene *s) { return s->meshes.count; }
static const ufbx_mesh *mesh(const ufbx_scene *s, size_t m) { return s->meshes.data[m]; }
size_t ps2_mesh_num_vertices(const ufbx_scene *s, size_t m) { return mesh(s, m)->num_vertices; }
void ps2_mesh_vertices(const ufbx_scene *s, size_t m, double *out) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t i = 0; i < me->num_vertices; i++) {
		ufbx_vec3 v = me->vertices.data[i];
		out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
	}
}
size_t ps2_mesh_num_faces(const ufbx_scene *s, size_t m) { return mesh(s, m)->num_faces; }
int ps2_mesh_all_triangles(const ufbx_scene *s, size_t m) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t f = 0; f < me->num_faces; f++) if (me->faces.data[f].num_indices != 3) return 0;
	return 1;
}
void ps2_mesh_faces(const ufbx_scene *s, size_t m, uint32_t *begin, uint32_t *count) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t f = 0; f < me->num_faces; f++) {
		begin[f] = me->faces.data[f].index_begin;
		count[f] = me->faces.data[f].num_indices;
	}
}
size_t ps2_mesh_num_indices(const ufbx_scene *s, size_t m) { return mesh(s, m)->num_indices; }
void ps2_mesh_indices(const ufbx_scene *s, size_t m, uint32_t *out) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t i = 0; i < me->num_indices; i++) out[i] = me->vertex_indices.data[i];
}
int ps2_mesh_has_normals(const ufbx_scene *s, size_t m) { return mesh(s, m)->vertex_normal.exists; }
void ps2_mesh_normals(const ufbx_scene *s, size_t m, double *out) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t i = 0; i < me->num_indices; i++) {
		ufbx_vec3 n = ufbx_get_vertex_vec3(&me->vertex_normal, i);
		out[i * 3] = n.x; out[i * 3 + 1] = n.y; out[i * 3 + 2] = n.z;
	}
}
int ps2_mesh_has_uvs(const ufbx_scene *s, size_t m) { return mesh(s, m)->vertex_uv.exists; }
void ps2_mesh_uvs(const ufbx_scene *s, size_t m, double *out) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t i = 0; i < me->num_indices; i++) {
		ufbx_vec2 t = ufbx_get_vertex_vec2(&me->vertex_uv, i);
		out[i * 2] = t.x; out[i * 2 + 1] = t.y;
	}
}
void ps2_mesh_face_materials(const ufbx_scene *s, size_t m, uint32_t *out) {
	const ufbx_mesh *me = mesh(s, m);
	for (size_t f = 0; f < me->num_faces; f++) out[f] = me->face_material.count ? me->face_material.data[f] : 0;
}
static const ufbx_material *mesh_material(const ufbx_scene *s, size_t m, size_t k) {
	/* Materials are attached to the instance node; fall back to the mesh's list. */
	const ufbx_mesh *me = mesh(s, m);
	if (me->instances.count && me->instances.data[0]->materials.count > k) return me->instances.data[0]->materials.data[k];
	return me->materials.count > k ? me->materials.data[k] : NULL;
}
size_t ps2_mesh_material_count(const ufbx_scene *s, size_t m) {
	const ufbx_mesh *me = mesh(s, m);
	return me->instances.count ? me->instances.data[0]->materials.count : me->materials.count;
}
const char *ps2_mesh_material_name(const ufbx_scene *s, size_t m, size_t k) {
	const ufbx_material *mat = mesh_material(s, m, k);
	return mat ? mat->name.data : "";
}
const char *ps2_mesh_material_texture(const ufbx_scene *s, size_t m, size_t k) {
	const ufbx_material *mat = mesh_material(s, m, k);
	if (!mat || !mat->fbx.diffuse_color.texture) return "";
	return mat->fbx.diffuse_color.texture->relative_filename.data;
}

static const ufbx_skin_cluster *cluster(const ufbx_scene *s, size_t m, size_t c) {
	return mesh(s, m)->skin_deformers.data[0]->clusters.data[c];
}
size_t ps2_skin_cluster_count(const ufbx_scene *s, size_t m) {
	const ufbx_mesh *me = mesh(s, m);
	return me->skin_deformers.count ? me->skin_deformers.data[0]->clusters.count : 0;
}
const char *ps2_cluster_bone(const ufbx_scene *s, size_t m, size_t c) {
	const ufbx_node *b = cluster(s, m, c)->bone_node;
	return b ? b->name.data : "";
}
size_t ps2_cluster_size(const ufbx_scene *s, size_t m, size_t c) { return cluster(s, m, c)->num_weights; }
void ps2_cluster_data(const ufbx_scene *s, size_t m, size_t c, uint32_t *verts, double *weights) {
	const ufbx_skin_cluster *cl = cluster(s, m, c);
	for (size_t i = 0; i < cl->num_weights; i++) {
		verts[i] = cl->vertices.data[i];
		weights[i] = cl->weights.data[i];
	}
}
void ps2_cluster_bind(const ufbx_scene *s, size_t m, size_t c, double out[16]) { matrix16(&cluster(s, m, c)->bind_to_world, out); }

static const ufbx_blend_channel *channel(const ufbx_scene *s, size_t m, size_t c) {
	return mesh(s, m)->blend_deformers.data[0]->channels.data[c];
}
size_t ps2_blend_channel_count(const ufbx_scene *s, size_t m) {
	const ufbx_mesh *me = mesh(s, m);
	return me->blend_deformers.count ? me->blend_deformers.data[0]->channels.count : 0;
}
const char *ps2_blend_channel_name(const ufbx_scene *s, size_t m, size_t c) { return channel(s, m, c)->name.data; }
static const ufbx_blend_shape *shape(const ufbx_scene *s, size_t m, size_t c) {
	const ufbx_blend_channel *ch = channel(s, m, c);
	return ch->keyframes.count ? ch->keyframes.data[0].shape : NULL;
}
size_t ps2_blend_shape_size(const ufbx_scene *s, size_t m, size_t c) {
	const ufbx_blend_shape *sh = shape(s, m, c);
	return sh ? sh->num_offsets : 0;
}
void ps2_blend_shape_data(const ufbx_scene *s, size_t m, size_t c, uint32_t *idx, double *pos, double *nrm) {
	const ufbx_blend_shape *sh = shape(s, m, c);
	if (!sh) return;
	for (size_t i = 0; i < sh->num_offsets; i++) {
		idx[i] = sh->offset_vertices.data[i];
		ufbx_vec3 p = sh->position_offsets.data[i];
		pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
		if (sh->normal_offsets.count > i) {
			ufbx_vec3 n = sh->normal_offsets.data[i];
			nrm[i * 3] = n.x; nrm[i * 3 + 1] = n.y; nrm[i * 3 + 2] = n.z;
		} else {
			nrm[i * 3] = nrm[i * 3 + 1] = nrm[i * 3 + 2] = 0;
		}
	}
}
