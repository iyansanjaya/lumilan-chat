"""D-Bus desktop fixture. Start only inside the smoke runner's private session bus."""
import json
import os
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

assert os.environ.get('LUMILAN_DESKTOP_FIXTURE') == '1', 'Use the isolated smoke runner'
DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()


class ScreenSaver(dbus.service.Object):
    active = False

    @dbus.service.method('org.gnome.ScreenSaver', out_signature='b')
    def GetActive(self):
        return self.active

    @dbus.service.method('org.gnome.ScreenSaver', in_signature='b')
    def SetActive(self, active):
        self.active = bool(active)
        self.ActiveChanged(self.active)

    @dbus.service.signal('org.gnome.ScreenSaver', signature='b')
    def ActiveChanged(self, active):
        pass


class Notifications(dbus.service.Object):
    messages = []

    @dbus.service.method('org.freedesktop.Notifications', out_signature='as')
    def GetCapabilities(self):
        return ['body']

    @dbus.service.method('org.freedesktop.Notifications', out_signature='ssss')
    def GetServerInformation(self):
        return ('Lumilan isolated smoke', 'Lumilan', '1', '1.2')

    @dbus.service.method('org.freedesktop.Notifications', in_signature='susssasa{sv}i', out_signature='u')
    def Notify(self, app, replaces, icon, title, body, actions, hints, timeout):
        self.messages.append({'title': str(title), 'body': str(body)})
        assert len(self.messages) < 1024
        return len(self.messages)

    @dbus.service.method('org.freedesktop.Notifications', in_signature='u')
    def CloseNotification(self, id):
        self.NotificationClosed(id, 3)

    @dbus.service.signal('org.freedesktop.Notifications', signature='uu')
    def NotificationClosed(self, id, reason):
        pass

    @dbus.service.method('dev.lumilan.Smoke', out_signature='s')
    def History(self):
        return json.dumps(self.messages)

    @dbus.service.method('dev.lumilan.Smoke', out_signature='u')
    def Count(self):
        return len(self.messages)


lock_name = dbus.service.BusName('org.gnome.ScreenSaver', bus=bus)
lock = ScreenSaver(bus, '/org/gnome/ScreenSaver')
notification_name = dbus.service.BusName('org.freedesktop.Notifications', bus=bus)
notifications = Notifications(bus, '/org/freedesktop/Notifications')
print('Desktop fixture ready', flush=True)
GLib.MainLoop().run()
