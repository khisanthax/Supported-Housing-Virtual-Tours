#!/usr/bin/env bash
# Run with the prepared private directory and an external OpenPano checkout.
set -euo pipefail
export OMP_NUM_THREADS=4 LC_ALL=C
mode=$1
repo=$(realpath "$(dirname "$0")/..")
cd "$2"
case "$(pwd -P)/" in "$repo/"*) echo "Choose a private directory outside the checkout" >&2; exit 2;; esac
case "$mode" in
  watershed)
    /usr/bin/time -f '%e %M' -o watershed.time verdandi --wrap --seam=hard --output=watershed.tif tile*.tif >watershed.log 2>&1
    ;;
  lens)
    /usr/bin/time -f '%e %M' -o clean.time cpclean -o cleaned.pto controls.pto >clean.log 2>&1
    /usr/bin/time -f '%e %M' -o optimize.time autooptimiser -n -o optimized.pto cleaned.pto >optimize.log 2>&1
    /usr/bin/time -f '%e %M' -o nona.time nona -m TIFF_m -o tile optimized.pto >nona.log 2>&1
    /usr/bin/time -f '%e %M' -o watershed.time verdandi --wrap --seam=hard --output=watershed.tif tile*.tif >watershed.log 2>&1
    ;;
  coordinates)
    project=${3:-.}
    tmp=$(mktemp -d)
    trap 'rm -f "$tmp/in.txt" "$tmp/out.txt"; rmdir "$tmp"' EXIT
    cp probe-coordinates.txt "$tmp/in.txt"
    pano_trafo "$project/optimized.pto" <"$tmp/in.txt" >"$tmp/out.txt"
    cp "$tmp/out.txt" "$project/mapped.txt"
    ;;
  augmented)
    mkdir -p augmented
    cd augmented
    /usr/bin/time -f '%e %M' -o optimize.time autooptimiser -n -o optimized.pto ../augmented.pto > optimize.log 2>&1
    /usr/bin/time -f '%e %M' -o nona.time nona -m TIFF_m -o tile optimized.pto > nona.log 2>&1
    /usr/bin/time -f '%e %M' -o enblend.time enblend --wrap=horizontal --save-masks=mask-%n.tif -o hugin.tif tile*.tif > enblend.log 2>&1
    ;;
  render)
    /usr/bin/time -f '%e %M' -o optimize.time autooptimiser -n -o optimized.pto controls.pto > optimize.log 2>&1
    /usr/bin/time -f '%e %M' -o nona.time nona -m TIFF_m -o tile optimized.pto > nona.log 2>&1
    /usr/bin/time -f '%e %M' -o enblend.time enblend --wrap=horizontal --save-masks=mask-%n.tif -o hugin.tif tile*.tif > enblend.log 2>&1
    ;;
  hugin)
    /usr/bin/time -f '%e %M' -o cpfind.time cpfind --ncores=4 -o matched.pto initial.pto > cpfind.log 2>&1
    /usr/bin/time -f '%e %M' -o optimize.time autooptimiser -n -o optimized.pto matched.pto > optimize.log 2>&1
    /usr/bin/time -f '%e %M' -o nona.time nona -t 4 -m TIFF_m -o tile optimized.pto > nona.log 2>&1
    /usr/bin/time -f '%e %M' -o enblend.time enblend --wrap=horizontal --save-masks=mask-%n.tif -o hugin.tif tile*.tif > enblend.log 2>&1
    ;;
  openpano)
    src=$(realpath "$3")
    cmake -S "$src" -B op-build -DCMAKE_BUILD_TYPE=Release > openpano-build.log 2>&1
    cmake --build op-build -j4 >> openpano-build.log 2>&1
    cp "$src/src/config.cfg" config.cfg
    /usr/bin/time -f '%e %M' -o openpano.time op-build/src/image-stitching frame-*.jpg > openpano.log 2>&1
    ;;
  *) exit 2 ;;
esac
