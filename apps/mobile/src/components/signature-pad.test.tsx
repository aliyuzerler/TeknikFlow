import { fireEvent, render } from '@testing-library/react-native';
import { SignaturePad } from './signature-pad';

/**
 * TEST-08 §7 — imza tuvali: temizle düğmesi, boş-imza ipucu ve
 * strokes değişiklik bildirimi (native dokunma yok — davranış props'la).
 */

describe('SignaturePad', () => {
  it('etiket + boş ipucu + temizle düğmesi görünür', () => {
    const utils = render(<SignaturePad />);
    expect(utils.getByText('Müşteri imzası')).toBeTruthy();
    expect(utils.getByText('Buraya imzalayın')).toBeTruthy();
    expect(utils.getByLabelText('İmzayı temizle')).toBeTruthy();
  });

  it('özel etiket taşır', () => {
    const utils = render(<SignaturePad label="Teknisyen imzası" />);
    expect(utils.getByText('Teknisyen imzası')).toBeTruthy();
  });

  it('temizle: onStrokesChange boş diziyle çağrılır', () => {
    const onStrokesChange = jest.fn();
    const utils = render(<SignaturePad onStrokesChange={onStrokesChange} />);
    fireEvent.press(utils.getByTestId('signature-pad-clear'));
    expect(onStrokesChange).toHaveBeenCalledWith([]);
  });

  it('test kimlikleri (canvas/counter) erişilebilir', () => {
    const utils = render(<SignaturePad testIDPrefix="sig" />);
    expect(utils.getByTestId('sig-canvas')).toBeTruthy();
    expect(utils.getByTestId('sig-counter')).toBeTruthy();
    expect(utils.getByText(/0 nokta/)).toBeTruthy();
  });
});
