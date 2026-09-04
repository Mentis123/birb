#ifndef CZLIB_SHIM_H
#define CZLIB_SHIM_H

#include <stddef.h>

/// Upper bound on the compressed size for `src_len` input bytes.
size_t hc_deflate_bound(size_t src_len);

/// zlib-wrapped DEFLATE (RFC 1950: 0x78 header + Adler-32 trailer).
/// This is what PNG IDAT requires; Foundation's `.zlib` algorithm emits raw
/// RFC 1951 deflate with no header or checksum and produces PNGs that pass a
/// structural validator but fail every real decoder.
/// Returns the number of bytes written to `dst`, or 0 on failure.
size_t hc_zlib_compress(const unsigned char *src, size_t src_len,
                        unsigned char *dst, size_t dst_cap, int level);

/// Inverse of `hc_zlib_compress`, used by tests to prove the stream decodes.
/// Returns bytes written to `dst`, or 0 on failure.
size_t hc_zlib_decompress(const unsigned char *src, size_t src_len,
                          unsigned char *dst, size_t dst_cap);

/// CRC-32 (IEEE), the checksum PNG chunks use.
unsigned int hc_crc32(unsigned int crc, const unsigned char *buf, size_t len);

#endif
