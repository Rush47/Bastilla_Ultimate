
class PyPlot:
    def __init__(self):
        self._data = []
        self._title = ""
        self._xlabel = ""
        self._ylabel = ""

    def plot(self, *args, **kwargs):
        if args:
            self._data.append(args[0])

    def ylabel(self, label):
        self._ylabel = str(label)

    def xlabel(self, label):
        self._xlabel = str(label)

    def title(self, title):
        self._title = str(title)

    def show(self):
        t = self._title if self._title else "Figure"
        print("[MATPLOTLIB RENDERED: " + t + "] Y: " + str(self._ylabel) + ", X: " + str(self._xlabel))
        if self._data:
            print("Punkty danych: " + str(self._data[0]))

    def savefig(self, fname, *args, **kwargs):
        print("[MATPLOTLIB SAVED: " + str(fname) + "]")

_instance = PyPlot()
plot = _instance.plot
ylabel = _instance.ylabel
xlabel = _instance.xlabel
title = _instance.title
show = _instance.show
savefig = _instance.savefig
