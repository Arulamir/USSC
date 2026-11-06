import unittest
from unittest.mock import patch
import requests
from flask import Flask

from backend.api.camera import camera_bp
from mediamtx.public_hls import create_public_hls_blueprint


class PublicHlsTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(create_public_hls_blueprint('127.0.0.1', 'viewer', 'private-test-password'))
        self.client = app.test_client()

    @patch('mediamtx.public_hls.requests.Session')
    def test_playlist_query_range_and_server_auth_are_preserved(self, factory):
        session = factory.return_value.__enter__.return_value
        upstream = session.request.return_value.__enter__.return_value
        upstream.status_code = 206
        upstream.headers = {'Content-Type':'video/mp4', 'Content-Range':'bytes 0-3/4',
                            'Set-Cookie':'private-internal-cookie'}
        upstream.iter_content.return_value = [b'abcd']
        response = self.client.get('/hls/lidah_h264/video1_init.mp4?session=test-session&_HLS_msn=2&cookieCheck=1',
                                   headers={'Range':'bytes=0-3'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data,b'abcd')
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertNotIn('Set-Cookie',response.headers)
        args = session.request.call_args
        self.assertEqual(args.args[:2],('GET','http://127.0.0.1:8888/lidah_h264/video1_init.mp4'))
        self.assertEqual(args.kwargs['params'], {'session':'test-session','_HLS_msn':'2','cookieCheck':'1'})
        self.assertEqual(args.kwargs['auth'],('viewer','private-test-password'))
        self.assertEqual(args.kwargs['headers']['Range'],'bytes=0-3')
        self.assertFalse(args.kwargs['allow_redirects'])
        self.assertFalse(session.trust_env)

    @patch('mediamtx.public_hls.requests.Session')
    def test_private_paths_traversal_and_unknown_query_never_connect(self,factory):
        for path in ('/hls/private/index.m3u8','/hls/lidah_h264/config.yml',
                     '/hls/lidah_h264/../config.yml','/hls/lidah_h264/index.m3u8?url=http://example.com',
                     '/hls/lidah_h264/index.m3u8?_HLS_msn=bad'):
            with self.subTest(path=path):
                self.assertIn(self.client.get(path).status_code,(400,404))
        factory.assert_not_called()

    @patch('mediamtx.public_hls.requests.Session')
    def test_network_failure_does_not_expose_credentials(self,factory):
        session = factory.return_value.__enter__.return_value
        session.request.side_effect=requests.Timeout('private-test-password')
        response=self.client.get('/hls/ketintang_h264/index.m3u8')
        self.assertEqual(response.status_code,502)
        self.assertNotIn(b'private-test-password',response.data)

    @patch('mediamtx.public_hls.requests.Session')
    def test_redirect_and_oversized_segments_are_rejected(self,factory):
        session = factory.return_value.__enter__.return_value
        upstream=session.request.return_value.__enter__.return_value
        upstream.status_code=302
        self.assertEqual(self.client.get('/hls/lidah_h264/index.m3u8').status_code,502)
        upstream.status_code=200
        upstream.headers={}
        upstream.iter_content.return_value=[b'x'*(8*1024*1024+1)]
        self.assertEqual(self.client.get('/hls/lidah_h264/video1_init.mp4').status_code,502)


class PublicRoutingTests(unittest.TestCase):
    def setUp(self):
        app=Flask(__name__);app.register_blueprint(camera_bp);self.client=app.test_client()

    @patch('backend.api.camera.requests.Session')
    def test_main_api_routes_public_hls_and_whep_only(self,factory):
        session=factory.return_value.__enter__.return_value
        session.request.return_value.status_code=200
        session.request.return_value.content=b'playlist'
        session.request.return_value.headers={'Content-Type':'application/vnd.apple.mpegurl'}
        r=self.client.get('/api/cctv/hls/lidah_h264/index.m3u8?session=abc')
        self.assertEqual(r.status_code,200)
        self.assertEqual(session.request.call_args.args[1],'http://127.0.0.1:5003/hls/lidah_h264/index.m3u8')
        self.assertEqual(session.request.call_args.kwargs['params']['session'],'abc')
        self.client.post('/api/cctv/whep/ketintang_h264',data='offer',content_type='application/sdp')
        self.assertEqual(session.request.call_args.args[1],'http://127.0.0.1:5003/api/whep/ketintang_h264')
        session.request.reset_mock()
        for path in ('admin/cameras','whep/private','hls/private/index.m3u8','hls/lidah_h264/private.yml'):
            self.assertEqual(self.client.get('/api/cctv/'+path).status_code,404)
        session.request.assert_not_called()


if __name__=='__main__':unittest.main()
