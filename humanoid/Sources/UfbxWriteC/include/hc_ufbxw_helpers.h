#ifndef HC_UFBXW_HELPERS_H
#define HC_UFBXW_HELPERS_H

#include "ufbx_write.h"

/// Builds a `ufbxw_matrix` from 16 column-major doubles.
///
/// `ufbxw_matrix` is an anonymous union wrapping both a flat array and named
/// m<row><col> fields. Swift's C importer handles that shape poorly, so the
/// conversion lives here where the layout is unambiguous.
ufbxw_matrix hc_ufbxw_matrix(const double *column_major_16);

/// Convenience for the common pure-translation case.
ufbxw_matrix hc_ufbxw_translation(double x, double y, double z);

#endif
