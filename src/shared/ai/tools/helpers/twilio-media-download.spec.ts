import {
  TwilioMediaUrlError,
  assertTrustedTwilioMediaUrl,
  downloadTwilioInboundMedia,
} from './twilio-media-download';

describe('assertTrustedTwilioMediaUrl (anti-SSRF)', () => {
  it.each([
    'https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME',
    'https://mms.twiliocdn.com/abc',
    'https://media.twiliocdn.com/abc',
  ])('aceita host Twilio confiável: %s', (url) => {
    expect(() => assertTrustedTwilioMediaUrl(url)).not.toThrow();
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/', // metadata endpoint
    'http://localhost:6379/',
    'https://attacker.example.com/api.twilio.com/x',
    'https://api.twilio.com.attacker.com/x',
    'file:///etc/passwd',
    '',
    undefined,
    null,
  ])('rejeita URL não confiável: %s', (url) => {
    expect(() => assertTrustedTwilioMediaUrl(url as any)).toThrow(
      TwilioMediaUrlError,
    );
  });
});

describe('downloadTwilioInboundMedia', () => {
  it('recusa antes de qualquer fetch quando a URL não é de host confiável', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('x'));

    await expect(
      downloadTwilioInboundMedia(
        'http://169.254.169.254/latest/meta-data/',
        undefined,
      ),
    ).rejects.toThrow(TwilioMediaUrlError);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
