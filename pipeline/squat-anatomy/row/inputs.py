"""External inputs for the rowing spike (#754): pinned, fetched by python -m row fetch, never committed.

Engstrom et al. 2023 joint curves come from github.com/Telfer/Rowing_Biomechanics at a pinned commit. Each
sha256 below was taken from a file whose git blob sha1 (sha1(b'blob <len>\\0' + bytes)) equals the blob sha1 in
that repository's tree at ENGSTROM_COMMIT (GitHub API, git/trees/<commit>?recursive=1).

The BodyParts3D 4.0 OBJ archive answers the skin-source question (Q4). Its licence is recorded below as both
sources state it; by Scott's decision of 2026-11-24 the skin and anything derived from it are treated as
CC BY-SA 2.1 JP.
"""

ENGSTROM_REPO = 'Telfer/Rowing_Biomechanics'
ENGSTROM_COMMIT = '9d3ff4717065a45fe54d09cc081dc762d9bd5a61'
ENGSTROM_URL = f'https://raw.githubusercontent.com/{ENGSTROM_REPO}/{ENGSTROM_COMMIT}/'
ENGSTROM_SUBJECTS = ('RFP001', 'RFP002', 'RFP003', 'RFP010', 'RFP011', 'RFP012', 'RFP013', 'RFP014', 'RFP015',
                     'RFP016', 'RFP017')
ENGSTROM_JOINTS = ('RightKnee', 'RightHip', 'RightAnkle', 'RightElbow', 'RightShoulder', 'LowerBack', 'UpperBack')
ENGSTROM_CITATION = ('Engstrom, Anderson, Bez, Agresta & Telfer (2023), PLOS ONE 18(5): e0285676; '
                     'data github.com/Telfer/Rowing_Biomechanics (MIT)')

ENGSTROM_FILES = {
    'Data/RFP001/LowerBack.txt': '3c2cd47eb9d29448320fb388b33c6deccbea0b219d0d0796fd8cec1eabc1d98f',
    'Data/RFP001/RightAnkle.txt': 'd67068cfdf25004b96f29342561ab923c61e3ab5340f2c88d0bb1b488b5500fb',
    'Data/RFP001/RightElbow.txt': '0f5c6da9a381f6e3cf255eb5034043a227f8da222b92f9270d47c4e97367f5a6',
    'Data/RFP001/RightHip.txt': '0aff8fe868b49726b586ab296596120e73351b2216a24d9ee566a543e8027868',
    'Data/RFP001/RightKnee.txt': '5233e4038f1af773d9d3dc9a45c07f93231807e2ce6e56ba90e95c9ff64e4945',
    'Data/RFP001/RightShoulder.txt': '4338f0e1b1557853fdb23b4aecbc43741a59e71537ccf8bfa236f05c3d8a7073',
    'Data/RFP001/UpperBack.txt': 'f9e9fbfc5d9abe4d517affa13435cb5f698e42a19a631418a74919a5dfb1669a',
    'Data/RFP001/events.txt': 'c1d41b9feab662f98938c6f7e4799040970a84942edb2dca7612958c78611d8c',
    'Data/RFP002/LowerBack.txt': '784d0fb26c4341b08bd4a53fdc8c8b3ac85ac8917280c4051e307d939c9af377',
    'Data/RFP002/RightAnkle.txt': 'eb81539467b73feaf90fcb0c3b5cca2942be925482c757bfc8b251b68a199ea4',
    'Data/RFP002/RightElbow.txt': 'e2cb9ffb4eb5c4225eb37ca3165183328a108ad8c5dd2e96d0338e13e49dec1d',
    'Data/RFP002/RightHip.txt': 'b797e0909565a14b4bed38f69fd3b9512933c5e8c8f0bad5e72a5e233b3333b6',
    'Data/RFP002/RightKnee.txt': '33491a4744fb89cafca4cd306622119149e6305a69d5acf21176380693c0078f',
    'Data/RFP002/RightShoulder.txt': '1dda35b3e3425a7d8831d23fa61749bc767529867f4de18f0766a00553e33a26',
    'Data/RFP002/UpperBack.txt': '234168b47ea12090bb2db0dc06a352d113012daa161461b3389ce35296dbda6b',
    'Data/RFP002/events.txt': '03be6ebea78ffa0b44ce96338242f7304574fd56ddb6fb4fc8a3bd10817a5756',
    'Data/RFP003/LowerBack.txt': '80e2406e53ce2510b80a18a6c7874c0f29421467be314016c12c9f8fa86c2f24',
    'Data/RFP003/RightAnkle.txt': 'e60d5ce048f9d4d8fcf2fffd8aebf094860235f632f7c0f0b70e788eb42848ad',
    'Data/RFP003/RightElbow.txt': '7456dbcab8cdaa4db0ec14fa734b6f94cb6436df164ada08ae141bb98d7bc01e',
    'Data/RFP003/RightHip.txt': '9df3e4e27fbed5d102fb33170e59ba49333eb87ccaf6abd4f4788a7dfc2d1457',
    'Data/RFP003/RightKnee.txt': '5e8326188f72fce3a12b66bff1fbc2c9867554eb75ad1a804840be68dbe2f47a',
    'Data/RFP003/RightShoulder.txt': 'fda4a7249c289cfd016d41d5e2e170ffa859a6a3714b542959185cdea256895f',
    'Data/RFP003/UpperBack.txt': 'babfb14f58d59c5c807acd9ac6894435be39106d60af5ae7df3c228757171c76',
    'Data/RFP003/events.txt': '381fbed8e99639490d73e938109a2e99ecacb73435c0cfdcd10d4e16a3921b35',
    'Data/RFP010/LowerBack.txt': '7b0c805bcdee135a29dc03cdab17761160844919e9a1cdc7c81e8532116dba52',
    'Data/RFP010/RightAnkle.txt': '852d42245e6b5abd432657659cf8c8a3935a07a60221ee8fdd730cc8ab227a22',
    'Data/RFP010/RightElbow.txt': '7c116042bb978e1d123ed875d5cb0cf1614f2db76f086abc1467773fa1f870f9',
    'Data/RFP010/RightHip.txt': '0b329905706fc5a680c1199c057200b4fd9ddfb64a331873712f9ca0268c4999',
    'Data/RFP010/RightKnee.txt': '4ac600d80f7569b1c1cb37e6e2ac982d29b68bce364177ea04e362ae0722e74f',
    'Data/RFP010/RightShoulder.txt': '7a4fd9dad958b2722c127c7fa01e6682dc50b99d22af328980e3f80ff7908b91',
    'Data/RFP010/UpperBack.txt': '55407f83f9f85aff4c74034b0bb5db1949b4606b9855a865062cf35e1d8335b6',
    'Data/RFP010/events.txt': 'd524606196d51ae7c4a84edd1e8b5cbc9b7ad672c8f80d3bd6d16fbf31ac1542',
    'Data/RFP011/LowerBack.txt': 'ca4bfe8874d22b2818cd1d45e8debaf60c875859066f66b6dc4cd6bb95bb56b2',
    'Data/RFP011/RightAnkle.txt': 'aa791f1ed891cd584665cf7b9d36316d640126d68cdb29fb39a75b396b126beb',
    'Data/RFP011/RightElbow.txt': 'acb4ff69104ea1f19424a6d4b1e6ed520fb16fb1ea958e145bed6fed5eafbc04',
    'Data/RFP011/RightHip.txt': 'b28702100d8e77c2a058b94190bcd4826b4899025a83db527bd6ba847ffeda71',
    'Data/RFP011/RightKnee.txt': 'e638d1df5b8f15998490749b0652840075d7a8ee57227242f04d49669fdd35f4',
    'Data/RFP011/RightShoulder.txt': '6bb6059a83a75930fa871b9164fc6364cfa5566c445cc6cce811b8f71f6b0222',
    'Data/RFP011/UpperBack.txt': '6ca85ba3399fa3c318589719b35bc56be2405270da4663f621595503de308954',
    'Data/RFP011/events.txt': 'eda0ea6562c8c06f3def131e648418ddef256ab0d8a9323f8a633a71f36c0cbd',
    'Data/RFP012/LowerBack.txt': 'cf729e9776d649900b42511d1da8f8f26ed85e94562d2f00a648fbb7ea0fc013',
    'Data/RFP012/RightAnkle.txt': '1cf2a60c3464cd5fd3db5429935582637a9769e93efa0cfa9c811ec02400be5b',
    'Data/RFP012/RightElbow.txt': 'a8c7b00f2b95c241c1b13540e0f224d001c1fe88da254d57b306a4ddb7d3e985',
    'Data/RFP012/RightHip.txt': '58a6c3de7d7567e8e76fd53eba0525171f2e4873062d1d432d00d8612304f542',
    'Data/RFP012/RightKnee.txt': '7f228a5de1c254ef178f0f740e0c44c22001572391d2da5ed7c7a3d816d60bcd',
    'Data/RFP012/RightShoulder.txt': 'd27a60aa0821a45397420985f91a425c145035a777fa3802fc6386874f8d1a6f',
    'Data/RFP012/UpperBack.txt': '916fea5f2ef0b40bd5ffe24895186cb360c925350ee0b8d09f91cd46666a508f',
    'Data/RFP012/events.txt': '13ee4b9d342cdadccfee9516bf69bf4e7113bdcfba6dd06039244fdc4512d6e0',
    'Data/RFP013/LowerBack.txt': 'a1ae264a2f6964fa6df4de0a053253621b3ea1b067639de4430153c265ab3fad',
    'Data/RFP013/RightAnkle.txt': '2928602d218e42674b67ba0162f8afba6844c114e872549803094046443862f7',
    'Data/RFP013/RightElbow.txt': 'ccf2048cb55d747cf6797b79a38ed2e43694173941f650c97d38144f028e3e88',
    'Data/RFP013/RightHip.txt': '520d47fe267f357ef3bc19c7b7797643bd35ccc8dac8b2f9e16425c5358ee81b',
    'Data/RFP013/RightKnee.txt': 'd1693b6fb0ef9a5a72890fea774bbb19c71fa3da9371804609384ae992cbe76c',
    'Data/RFP013/RightShoulder.txt': '35f5ae1be834fc34d71e86358b9c541c21f91c620da613c14e7647ca318ea6d1',
    'Data/RFP013/UpperBack.txt': '17f30861b05573945dd5ed0bed3f544407a71152329b328c08e3479e86b4d324',
    'Data/RFP013/events.txt': '16fd8f8728494579f38739c63eb3a6114e0f0b11f91f1b99054a2362bcd0223d',
    'Data/RFP014/LowerBack.txt': '13e56c0109b686fbeea4b7ad490bcd0426309dc5c858b7efac9e459032ead98d',
    'Data/RFP014/RightAnkle.txt': 'dd1de3b2e467fbab60b428248b70bc6d415914d94e5bb8b6e11003eb6a84a8a7',
    'Data/RFP014/RightElbow.txt': '611142246eccc07e97294e4897b0ad410583c3347e45f4150f06242f65cf1844',
    'Data/RFP014/RightHip.txt': '65d86a4b31bb41b9060a94ccb5a5ed6034c8a0a39354abf47ca2732b5ed70ddd',
    'Data/RFP014/RightKnee.txt': '5161a355e04bccee8c9728bd99934902692cb7cb0ca3eeb6297754cb73bf8e33',
    'Data/RFP014/RightShoulder.txt': '78035ff2ee93136fde06e17ea0e56ec9de5ad5640a2d237f06252b9b0093fde2',
    'Data/RFP014/UpperBack.txt': 'a9b4151ef923cc727f53eb684d9323769ec395aff62a86858ed6caf83cb9bd82',
    'Data/RFP014/events.txt': 'd1af2ec243be385736f07b3409c4764dfe7000f73bc3df41294cf0f544383676',
    'Data/RFP015/LowerBack.txt': '7720c2a18f1c7ef13649b9ce6eff2e7721177241a76f375ad0854fd1298b82a9',
    'Data/RFP015/RightAnkle.txt': '812942516b6a035ea5e7014ae30fc673186715e6af511b3292c055e396bdc25e',
    'Data/RFP015/RightElbow.txt': 'b2bf23da9af4aa8646dd22d8c94feeea98bf226e0e455930e583b822dc176557',
    'Data/RFP015/RightHip.txt': 'ff9964921d4a4d71f75ff1c6ee152347be4abbf3630b30570d94530af8195fe1',
    'Data/RFP015/RightKnee.txt': '13f8d0f4791aa87db1a46f63c1169ac61263b836eca08036f9c43e47a5ab3a37',
    'Data/RFP015/RightShoulder.txt': '2eb8d8507b1588ca107044e5bcedd23bca1c3df37951bc0252adff6742825b67',
    'Data/RFP015/UpperBack.txt': 'c29f1a22f3cc39028fed2eb4e8475ff6bd9e2d0b9c8294362ad27bbde99ff28f',
    'Data/RFP015/events.txt': '78a6661e4d223cc104a20cf3cc762ceae279342b873459f3588b4d16af2c7871',
    'Data/RFP016/LowerBack.txt': '0e11d1bb9a57c2982150fe96231cce273ae0468a25fe2d00a6b13c0aa59a2d64',
    'Data/RFP016/RightAnkle.txt': '42b3c46acf59d8fecb5fb827e9d00216f3e5390f45109bd969f796ad134c3497',
    'Data/RFP016/RightElbow.txt': '281593114b211533422eed70a4585a4686e3a4b1df54d41042ab11790f447cd4',
    'Data/RFP016/RightHip.txt': 'e9b3aa38cea560405c8272e278f02006026cb27c61bfa938eab8f0907fe883e5',
    'Data/RFP016/RightKnee.txt': '778aee4a64885dc645a68560a4ed10d5cbc3f1eb8d8c0297f9fa2f28bb7d771b',
    'Data/RFP016/RightShoulder.txt': 'e201d31388a60c4c8df10bfb2ac7fc617e55a2f2ff106f39f8c9905964f0e337',
    'Data/RFP016/UpperBack.txt': '8677fcf0faf108aeca09c723220048f71b8c05d372b313edc66e103f0a9a18e6',
    'Data/RFP016/events.txt': 'dd92c2e8c5c0a2e70d78b7265638ac8bb5d4c312e49b3ec95e0ff765e373f12a',
    'Data/RFP017/LowerBack.txt': 'c59a05a6f277b78ee15c0b61bf4d326126b01571fdc5cbfedf47284bf948e3da',
    'Data/RFP017/RightAnkle.txt': '742426bf80c87438a829f9864ce98e8de6400a355293cd180dfdc8f3b4dc903d',
    'Data/RFP017/RightElbow.txt': '5aaa78c8ed645a727eb04887e46845e2e4e5b5f44d2996dede7193a069446c7b',
    'Data/RFP017/RightHip.txt': '59642ed478791068efc9d4a4a55df66e4fb6ad67d52a2d4e7f7644fb0d512938',
    'Data/RFP017/RightKnee.txt': 'f6ce63de3df3b01288bd20138bc9aa4ede44c7698363b7af250dd13afa8a0cab',
    'Data/RFP017/RightShoulder.txt': 'accd96e6d8f0564b6a28f10834cd9cbee67360b03abbf2ebe24dae2158e58748',
    'Data/RFP017/UpperBack.txt': 'b8a60410d093d346c4b44266427eccf4b45ff6388570ee66c4e361ccb0b28fee',
    'Data/RFP017/events.txt': '505118464664fd658666f00a01d509d10c61b264e269038104b2339dc2600c43',
    'testtarget.txt': 'eec627eaf120fb48ac1d586edc4939d41c5850e78af3cc3b444f36a6edcfe7a0',
    'LICENSE': '4e5f740ea5d93f374dd0aed29403dfdb2ce01b27ad16f6aec6d1a9f490119612',
}

# The dataset's LICENSE at ENGSTROM_COMMIT, verbatim (the fetched copy is also kept beside the data).
ENGSTROM_LICENSE = '''MIT License

Copyright (c) 2023 Telfer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'''

SKIN_URL = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip'
SKIN_ZIP = 'partof_BP3D_4.0_obj_99.zip'
SKIN_BYTES = 64_888_505
SKIN_SHA256 = '9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97'
PARTS_URL = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_element_parts.txt'
PARTS_FILE = 'partof_element_parts.txt'
PARTS_SHA256 = '3f5f6df1028eb122b30de77c711597b6bb8e5541658e5985859fd228adbf88ea'
# The database licence page says CC BY 4.0 (updated 2025-02-27); every OBJ in the archive opens with a CC BY-SA
# 2.1 JP grant (FJ2810.obj, line 2). Scott decided on 2026-11-24 to treat the skin and anything derived from it as
# CC BY-SA 2.1 JP, recording both statements.
SKIN_LICENCE_PAGE = 'CC BY 4.0, per the BodyParts3D licence page (updated 2025-02-27)'
SKIN_LICENCE_HEADER = 'CC BY-SA 2.1 JP, per the OBJ file headers in the archive'
SKIN_LICENCE_TREATED = 'CC BY-SA 2.1 JP (Scott\'s decision of 2026-11-24)'
SKIN_ATTRIBUTION = ('BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike '
                    '2.1 Japan')

# BodyParts3D 4.0 element files (partof_element_parts.txt): the skin, and the bones Q4 registers to 3.0.
SKIN_FJ = 'FJ2810'
BONE_FJ = {
    'clavicle': 'FJ3362', 'scapula': 'FJ3384', 'humerus': 'FJ3368', 'radius': 'FJ3349', 'ulna': 'FJ3391',
    'lunate': 'FJ3374', 'capitate': 'FJ3361', 'metacarpal3': 'FJ3354', 'femur': 'FJ3365', 'tibia': 'FJ3387',
    'fibula': 'FJ3366', 'talus': 'FJ3385', 'patella': 'FJ3381', 'calcaneus': 'FJ3360', 'sacrum': 'FJ3393',
    'hip_bone': 'FJ3152',
}

# sha256 of each member as extracted to obj/<FJ>.obj.
SKIN_MEMBERS = {
    'FJ2810.obj': '50fb17d0b3559b8b6c5481dbe7f877d25726e576564da615c45b2dd7654e315d',
    'FJ3152.obj': '708e42cba3d1817230c98410c80742875d56bb5b3e688a566f62509c7a63e424',
    'FJ3349.obj': 'be1ebc9c5285cc934c625763b3363fc3133efab9eafdf1edf0b36de3b7ee06a9',
    'FJ3354.obj': 'ce10ec6c9f5c3428593ae8ba0a8be016df7905f39e7d3d7ca930d60da76d0d90',
    'FJ3360.obj': 'c278cca7a72dc6fc4eee55a348b0020522d99f72209eafe60f35ba4f7258682b',
    'FJ3361.obj': '25066d1353fd200871374beffaaed8c6c5ef694148385f3fd33fd5b63bd017ce',
    'FJ3362.obj': '1435b8f365652b215180e398b894a5bdfbf9cb13d00ccf06d07038b962e957b9',
    'FJ3365.obj': '02fffe2e1b0f8e038d8b7b48e47cbc4925a749446240e676e910bff34d5348de',
    'FJ3366.obj': '05bf4de7604e2fd5099b3a5337d243d2d40f2b8f80daf1694b3aba394aa93942',
    'FJ3368.obj': '159fbdeb854044e7b0ebd0d48cfe332afb44a691d09b89ff644a851826d08268',
    'FJ3374.obj': '7b607f05b221c86aa6b3f93fc9d37d860281941ed293c4afc1affdb1ef379fc4',
    'FJ3381.obj': '3f53300560b903d8fbc4165af3cdafab8d4f1d0a941ca59c7ef5169d0b838b8a',
    'FJ3384.obj': 'cb68b2e01a22989f20e602d5036a3f1fb28448fe647f599b9bbd61edfbff2320',
    'FJ3385.obj': '2332712fbc270403f10f8a99259493758831a6c68c9f54e59ee8d7c3d7281811',
    'FJ3387.obj': 'a658d28799577c26cdf8318aef799dbe90564355a28b5098d8707eee907f9c7d',
    'FJ3391.obj': 'c84d953caa7613d6640593003ead91449eb1aaedc74cb2b27ae103e2177d3871',
    'FJ3393.obj': 'fd95a0b26f450e4939858c9effb7b14e589874c9210edfdb92e8f4552dd484de',
}
