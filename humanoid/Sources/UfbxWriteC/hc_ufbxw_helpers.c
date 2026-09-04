#include "include/hc_ufbxw_helpers.h"

ufbxw_matrix hc_ufbxw_matrix(const double *column_major_16) {
    ufbxw_matrix out;
    for (int i = 0; i < 16; i++) {
        out.m[i] = (ufbxw_real)column_major_16[i];
    }
    return out;
}

ufbxw_matrix hc_ufbxw_translation(double x, double y, double z) {
    ufbxw_matrix out = ufbxw_identity_matrix;
    // Column-major: translation occupies elements 12, 13, 14.
    out.m[12] = (ufbxw_real)x;
    out.m[13] = (ufbxw_real)y;
    out.m[14] = (ufbxw_real)z;
    return out;
}
