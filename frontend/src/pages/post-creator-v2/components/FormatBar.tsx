import { usePostFormat } from '../format/PostFormatContext'
import { CustomSizeInputs, FormatSelect, PlatformSelect, sizeReadout } from './FormatFields'

/** PLATFORM | FORMAT | SIZE / RATIO — sits immediately above the central canvas and drives its shape. */
export default function FormatBar() {
  const { canvas } = usePostFormat()
  return (
    <div className="pcv2-format-bar" data-testid="pcv2-format-bar">
      <label className="pcv2-format-field">
        <span className="pcv2-format-label">Platform</span>
        <PlatformSelect />
      </label>
      <label className="pcv2-format-field pcv2-format-field-grow">
        <span className="pcv2-format-label">Format</span>
        <FormatSelect />
      </label>
      <div className="pcv2-format-field">
        <span className="pcv2-format-label">Size / ratio</span>
        <div className="pcv2-format-size" data-testid="pcv2-size-readout">
          {canvas.isCustom ? <CustomSizeInputs /> : null}
          <span className="pcv2-format-readout">{sizeReadout(canvas)}</span>
        </div>
      </div>
    </div>
  )
}
