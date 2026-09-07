/**
 * icons/copilot-2023.js — the Microsoft Copilot icon (September 2023 mark).
 *
 * A transcription, not a drawing. Path data and gradient definitions are copied
 * verbatim from the vector Wikipedia serves for the mark
 * (https://en.wikipedia.org/wiki/File:Microsoft_Copilot_Icon.svg, a Figma
 * export in a 48-unit viewBox), so every coordinate below can be diffed against
 * the source file. The mark is Microsoft's; it is reproduced here as a
 * modelling study, the way an architecture diagram reproduces a service icon.
 *
 * The source paints six paths. Two are duplicates of the bands carrying a
 * semi-transparent highlight gradient; here those become the band's `overlay`
 * instead of a second coplanar plate that would z-fight the first.
 *
 * `layer` is the 3D stacking order (higher = nearer the viewer). It follows the
 * SVG paint order, which is what Blender's importer does too: the pink band is
 * painted last and stands in front, the blue band behind it, and both folds go
 * behind BOTH bands — each fold has a tucked-under portion hidden by a band
 * (the blue fold's left end under the blue band, the red fold's notch under the
 * blue band and its right half under the pink band), so putting either fold
 * level with a band intersects it.
 */

const fold_blue = {
    type: 'radial', units: 'userSpaceOnUse', cx: 0, cy: 0, r: 1,
    transform: 'translate(38.005 20.5144) rotate(-129.304) scale(17.3033 16.2706)',
    stops: [[0.0955758, '#00AEFF'], [0.773185, '#2253CE'], [1, '#0736C4']],
};
const fold_red = {
    type: 'radial', units: 'userSpaceOnUse', cx: 0, cy: 0, r: 1,
    transform: 'translate(11.1215 32.8171) rotate(51.84) scale(15.9912 15.5119)',
    stops: [[0, '#FFB657'], [0.633728, '#FF5F3D'], [0.923392, '#C02B3C']],
};
const band_blue = {
    type: 'linear', units: 'userSpaceOnUse', x1: 12.5, y1: 7.5, x2: 14.7884, y2: 33.9751,
    stops: [[0.156162, '#0D91E1'], [0.487484, '#52B471'], [0.652394, '#98BD42'], [0.937361, '#FFC800']],
};
const band_blue_sheen = {
    type: 'linear', units: 'userSpaceOnUse', x1: 14.5, y1: 4, x2: 15.7496, y2: 32.8852,
    stops: [[0, '#3DCBFF'], [0.246674, '#0588F7', 0]],
};
const band_pink = {
    type: 'radial', units: 'userSpaceOnUse', cx: 0, cy: 0, r: 1,
    transform: 'translate(41.3187 12.2813) rotate(109.274) scale(38.3873 45.9867)',
    stops: [[0.0661714, '#8C48FF'], [0.5, '#F2598A'], [0.895833, '#FFB152']],
};
const band_pink_sheen = {
    type: 'linear', units: 'userSpaceOnUse', x1: 42.5859, y1: 13.346, x2: 42.5695, y2: 21.2147,
    stops: [[0.0581535, '#F8ADFA'], [0.708063, '#A86EDD', 0]],
};

export default {
    id: 'copilot-2023',
    name: 'Microsoft Copilot (2023 mark)',
    source: 'https://en.wikipedia.org/wiki/File:Microsoft_Copilot_Icon.svg',
    viewBox: [0, 0, 48, 48],
    pieces: [
        {
            id: 'fold_blue', layer: -2,
            d: 'M34.1423 7.32501C33.5634 5.35387 31.7547 4 29.7003 4L28.3488 4C26.1142 4 24.1985 5.59611 23.7952 7.79398L21.4805 20.4072L22.0549 18.4419C22.6319 16.4679 24.4419 15.1111 26.4986 15.1111H34.3524L37.6462 16.3942L40.8213 15.1111H39.8946C37.8401 15.1111 36.0315 13.7572 35.4525 11.7861L34.1423 7.32501Z',
            fill: { base: fold_blue },
        },
        {
            id: 'fold_red', layer: -2,
            d: 'M14.3307 40.656C14.9032 42.6366 16.7165 44 18.7783 44H21.6486C24.1592 44 26.2122 41.999 26.2767 39.4893L26.5893 27.3271L25.9354 29.5602C25.3577 31.5332 23.5481 32.8889 21.4923 32.8889L13.5732 32.8889L10.7499 31.3573L7.69336 32.8889H8.60461C10.6663 32.8889 12.4796 34.2522 13.0521 36.2329L14.3307 40.656Z',
            fill: { base: fold_red },
        },
        {
            id: 'band_blue', layer: -1,
            d: 'M29.4993 4H13.46C8.87732 4 6.12772 10.0566 4.29466 16.1132C2.12296 23.2886 -0.718769 32.8852 7.50252 32.8852H14.4282C16.4978 32.8852 18.3147 31.5168 18.8835 29.5269C20.0876 25.3143 22.1978 17.9655 23.8554 12.3712C24.6977 9.52831 25.3993 7.08673 26.4762 5.56628C27.0799 4.71385 28.086 4 29.4993 4Z',
            fill: { base: band_blue, overlay: band_blue_sheen },
        },
        {
            id: 'band_pink', layer: 0,
            d: 'M18.498 44H34.5374C39.12 44 41.8696 37.9424 43.7027 31.8848C45.8744 24.7081 48.7161 15.1098 40.4948 15.1098H33.5693C31.4996 15.1098 29.6827 16.4784 29.114 18.4684C27.9098 22.6817 25.7996 30.032 24.142 35.6273C23.2996 38.4708 22.598 40.9127 21.5212 42.4335C20.9175 43.286 19.9113 44 18.498 44Z',
            fill: { base: band_pink, overlay: band_pink_sheen },
        },
    ],
};
