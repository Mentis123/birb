#include "include/CZlibShim.h"
#include <zlib.h>

size_t hc_deflate_bound(size_t src_len) {
    // compressBound is conservative; add room for the zlib header/trailer.
    return (size_t)compressBound((uLong)src_len) + 64;
}

size_t hc_zlib_compress(const unsigned char *src, size_t src_len,
                        unsigned char *dst, size_t dst_cap, int level) {
    uLongf out_len = (uLongf)dst_cap;
    int rc = compress2(dst, &out_len, src, (uLong)src_len, level);
    if (rc != Z_OK) return 0;
    return (size_t)out_len;
}

size_t hc_zlib_decompress(const unsigned char *src, size_t src_len,
                          unsigned char *dst, size_t dst_cap) {
    uLongf out_len = (uLongf)dst_cap;
    int rc = uncompress(dst, &out_len, src, (uLong)src_len);
    if (rc != Z_OK) return 0;
    return (size_t)out_len;
}

unsigned int hc_crc32(unsigned int crc, const unsigned char *buf, size_t len) {
    return (unsigned int)crc32((uLong)crc, buf, (uInt)len);
}
