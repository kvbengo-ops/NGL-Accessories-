// Both camera and jewellery use this aperture so their placement stays aligned.
export const mirrorFrame = `<svg class="try-on-mirror-art" viewBox="0 0 600 760" fill="none" aria-hidden="true" focusable="false">
<defs>
<clipPath id="try-on-mirror-aperture" clipPathUnits="objectBoundingBox"><path d="M.49 .098 C.635 .064 .795 .139 .811 .266 C.82 .349 .875 .399 .843 .514 C.819 .6 .861 .696 .785 .804 C.719 .899 .589 .911 .475 .894 C.36 .878 .241 .907 .181 .802 C.123 .701 .18 .603 .155 .498 C.128 .385 .188 .307 .182 .245 C.173 .156 .324 .12 .405 .13 C.454 .137 .44 .111 .49 .098Z"/></clipPath>
<clipPath id="try-on-mirror-reflected-aperture" clipPathUnits="objectBoundingBox"><path transform="translate(1 0) scale(-1 1)" d="M.49 .098 C.635 .064 .795 .139 .811 .266 C.82 .349 .875 .399 .843 .514 C.819 .6 .861 .696 .785 .804 C.719 .899 .589 .911 .475 .894 C.36 .878 .241 .907 .181 .802 C.123 .701 .18 .603 .155 .498 C.128 .385 .188 .307 .182 .245 C.173 .156 .324 .12 .405 .13 C.454 .137 .44 .111 .49 .098Z"/></clipPath>
<linearGradient id="mirror-ivory" x1="75" y1="35" x2="515" y2="730" gradientUnits="userSpaceOnUse"><stop stop-color="#fffdf1"/><stop offset=".28" stop-color="#f5ead6"/><stop offset=".52" stop-color="#fff9e9"/><stop offset=".78" stop-color="#e7dac3"/><stop offset="1" stop-color="#fbf3df"/></linearGradient>
<linearGradient id="mirror-leaf" x1="0" y1="0" x2="56" y2="115" gradientUnits="userSpaceOnUse"><stop stop-color="#b0c497"/><stop offset=".42" stop-color="#7f9b70"/><stop offset="1" stop-color="#4d7052"/></linearGradient>
<linearGradient id="mirror-petal" x1="-30" y1="-60" x2="30" y2="10" gradientUnits="userSpaceOnUse"><stop stop-color="#fff0e9"/><stop offset=".45" stop-color="#edb1b9"/><stop offset="1" stop-color="#b76b83"/></linearGradient>
<linearGradient id="mirror-petal-light" x1="-20" y1="-60" x2="16" y2="8" gradientUnits="userSpaceOnUse"><stop stop-color="#ffe6e0"/><stop offset=".55" stop-color="#f0bec5"/><stop offset="1" stop-color="#d18b9f"/></linearGradient>
<filter id="mirror-flower-shadow" x="-60%" y="-40%" width="220%" height="200%"><feDropShadow dx="2" dy="5" stdDeviation="3" flood-color="#5c523c" flood-opacity=".22"/></filter>
<path id="mirror-opening" d="M294 74.48 C381 48.64 477 105.64 486.6 202.16 C492 265.24 525 303.24 505.8 390.64 C491.4 456 516.6 528.96 471 611.04 C431.4 683.24 353.4 692.36 285 679.44 C216 667.28 144.6 689.32 108.6 609.52 C73.8 532.76 108 458.28 93 378.48 C76.8 292.6 112.8 233.32 109.2 186.2 C103.8 118.56 194.4 91.2 243 98.8 C272.4 104.12 264 84.36 294 74.48Z"/>
<g id="mirror-tulip">
<path d="M0 9 C8 42 -9 79 -1 108" stroke="#688260" stroke-width="6" stroke-linecap="round"/>
<path d="M-2 88 C-40 66 -37 38 -45 26 C-13 32 -5 61 -2 88Z M0 105 C32 85 24 51 37 36 C9 44 5 70 0 105Z" fill="url(#mirror-leaf)"/>
<path d="M-37 36 C-20 52 -9 71 -2 88 M30 46 C15 67 7 87 0 105" stroke="#d5dec0" stroke-opacity=".6" stroke-width="1.2"/>
<path d="M0 12 C-33 8 -37 -25 -24 -52 C-12 -49 -7 -41 0 -38 C10 -51 19 -56 27 -59 C39 -22 26 8 0 12Z" fill="url(#mirror-petal)"/>
<path d="M0 12 C-22 -5 -15 -40 0 -61 C17 -40 25 -3 0 12Z" fill="url(#mirror-petal-light)"/>
<path d="M0 12 C-32 7 -36 -18 -30 -44 C-8 -35 5 -16 0 12Z" fill="url(#mirror-petal-light)"/>
<path d="M0 12 C30 5 36 -25 28 -48 C8 -30 -4 -12 0 12Z" fill="url(#mirror-petal)"/>
<path d="M-28 -39 C-26 -17 -17 0 -5 6 M2 -48 C-4 -32 -5 -20 -2 -10" stroke="#fff6ed" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/>
</g></defs>
<path fill="url(#mirror-ivory)" fill-rule="evenodd" d="M290 40 C341 13 390 43 412 57 C446 78 479 61 505 102 C533 146 519 185 537 229 C565 295 538 336 545 392 C554 456 564 483 538 550 C520 597 517 654 474 686 C439 712 404 700 367 717 C329 735 292 705 254 717 C213 730 187 710 158 702 C111 690 77 705 62 652 C47 603 71 570 56 526 C40 478 71 438 61 391 C48 333 74 299 68 253 C60 209 80 190 76 160 C67 96 135 64 186 72 C222 78 246 65 290 40Z M294 74.48 C381 48.64 477 105.64 486.6 202.16 C492 265.24 525 303.24 505.8 390.64 C491.4 456 516.6 528.96 471 611.04 C431.4 683.24 353.4 692.36 285 679.44 C216 667.28 144.6 689.32 108.6 609.52 C73.8 532.76 108 458.28 93 378.48 C76.8 292.6 112.8 233.32 109.2 186.2 C103.8 118.56 194.4 91.2 243 98.8 C272.4 104.12 264 84.36 294 74.48Z"/>
<use href="#mirror-opening" stroke="#cabb9d" stroke-width="7" stroke-opacity=".55"/><use href="#mirror-opening" stroke="#fffdf3" stroke-width="2"/>
<path d="M292 51 C348 29 386 59 414 69 C458 90 482 78 503 116 M529 291 C516 341 537 392 528 449 M523 574 C496 651 474 681 419 688 M306 706 C253 691 217 718 170 687 M78 598 C63 555 79 532 70 503 M79 280 C91 239 83 210 89 179 C93 117 143 86 191 87" stroke="#fffef6" stroke-width="4" stroke-linecap="round" opacity=".8"/>
<g filter="url(#mirror-flower-shadow)">
<path d="M144 210 C60 167 59 94 132 49 C171 25 192 47 217 29 C207 67 158 59 134 78 C97 108 99 153 144 210Z" fill="url(#mirror-leaf)"/><path d="M94 165 C93 116 123 66 190 46" stroke="#dce4c7" stroke-width="2" opacity=".7"/>
<use href="#mirror-tulip" transform="translate(100 102) rotate(-28) scale(.95)"/><use href="#mirror-tulip" transform="translate(155 72) rotate(18) scale(.78)"/><use href="#mirror-tulip" transform="translate(65 175) rotate(-15) scale(.7)"/>
<path d="M479 596 C529 548 551 595 567 552 C578 606 533 628 518 657 C502 687 507 714 462 729 C484 690 457 653 479 596Z" fill="url(#mirror-leaf)"/><path d="M475 712 C503 668 502 626 550 586" stroke="#dce4c7" stroke-width="2" opacity=".65"/>
<use href="#mirror-tulip" transform="translate(534 559) rotate(24) scale(.95)"/><use href="#mirror-tulip" transform="translate(505 632) rotate(-28) scale(.78)"/><use href="#mirror-tulip" transform="translate(442 697) rotate(72) scale(.62)"/>
</g></svg>`;
